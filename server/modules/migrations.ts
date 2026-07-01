import { type Router, type Ctx, json, readJson, badRequest, notFound, forbidden } from '../lib/http'
import { query, queryOne, execute } from '../db/pool'
import { requireUser, requireCapability, can, userOrgIds, assertOrgMember } from '../lib/auth'
import { newId } from '../lib/ids'
import { iso, asJson } from '../lib/serialize'
import { writeAudit } from '../lib/audit'
import { getConnectionSecret } from './databases.repo'
import { applyStatements } from '../lib/externalDb'
import { notifyMigration } from '../lib/slack'
import { env } from '../env'
import type { MigrationStatus, SessionUser } from '../types'

interface MigRow {
  id: string
  database_id: string
  db_name: string
  engine: string
  org_id: string
  title: string
  description: string | null
  status: MigrationStatus
  author_email: string
  approved_by: string | null
  approved_at: Date | null
  applied_at: Date | null
  scheduled_for: Date | null
  scheduled_by: string | null
  created_at: Date
  approvers: unknown
  releasers: unknown
  required_approvals: number | null
  allow_self_approval: number | null
}

const MIG_SELECT = `
  SELECT m.*, d.name AS db_name, d.engine, p.org_id,
         ps.approvers, ps.releasers, ps.required_approvals, ps.allow_self_approval
  FROM migrations m
  JOIN \`databases\` d ON d.id = m.database_id
  JOIN projects p ON p.id = d.project_id
  LEFT JOIN project_settings ps ON ps.project_id = p.id`

async function fullMigration(row: MigRow) {
  const queries = await query<{ id: string; ord: number; sql_text: string }>(
    'SELECT id, ord, sql_text FROM migration_queries WHERE migration_id = :id ORDER BY ord',
    { id: row.id },
  )
  const reviewers = await query<{ reviewer_email: string }>(
    'SELECT reviewer_email FROM migration_reviewers WHERE migration_id = :id',
    { id: row.id },
  )
  const comments = await query<{ id: string; author_email: string; author_name: string | null; body: string; created_at: Date }>(
    'SELECT id, author_email, author_name, body, created_at FROM migration_comments WHERE migration_id = :id ORDER BY created_at',
    { id: row.id },
  )
  const events = await query<{ at: Date; actor_email: string; action: string; note: string | null }>(
    'SELECT at, actor_email, action, note FROM migration_events WHERE migration_id = :id ORDER BY at',
    { id: row.id },
  )
  return {
    id: row.id,
    database_id: row.database_id,
    database_name: row.db_name,
    engine: row.engine,
    title: row.title,
    description: row.description,
    status: row.status,
    author_email: row.author_email,
    approvers: asJson<string[]>(row.approvers, []),
    releasers: asJson<string[]>(row.releasers, []),
    required_approvals: Math.max(1, Number(row.required_approvals) || 1),
    reviewers: reviewers.map((r) => r.reviewer_email),
    queries: queries.map((q) => ({ id: q.id, order: Number(q.ord), sql: q.sql_text })),
    comments: comments.map((c) => ({ id: c.id, author_email: c.author_email, author_name: c.author_name, body: c.body, created_at: iso(c.created_at)! })),
    created_at: iso(row.created_at)!,
    approved_by: row.approved_by,
    approved_at: iso(row.approved_at),
    applied_at: iso(row.applied_at),
    scheduled_for: iso(row.scheduled_for),
    scheduled_by: row.scheduled_by,
    events: events.map((e) => ({ at: iso(e.at)!, actor_email: e.actor_email, action: e.action, note: e.note })),
  }
}

async function loadMig(userId: string, id: string): Promise<MigRow> {
  const row = await queryOne<MigRow>(`${MIG_SELECT} WHERE m.id = :id`, { id })
  if (!row) throw notFound('Migration not found')
  await assertOrgMember(userId, row.org_id)
  return row
}

async function addEvent(migrationId: string, actorEmail: string, action: string, note: string | null) {
  await execute('INSERT INTO migration_events (id, migration_id, actor_email, action, note) VALUES (:id, :m, :a, :act, :note)', {
    id: newId('ev'), m: migrationId, a: actorEmail, act: action, note,
  })
}

const NEXT_STATUS: Record<string, MigrationStatus> = {
  submit: 'pending_approval',
  approve: 'approved',
  reject: 'rejected',
  apply: 'applied',
}

// Approved migrations whose scheduled time has arrived (used by the scheduler).
export async function dueScheduledMigrations(): Promise<MigRow[]> {
  return query<MigRow>(
    `${MIG_SELECT} WHERE m.status = 'approved' AND m.scheduled_for IS NOT NULL AND m.scheduled_for <= NOW()`,
  )
}

// Apply an approved migration to its database immediately. Shared by the manual
// apply route and the background scheduler, so it takes a plain actor email
// (the scheduler has no session). On success the migration is marked applied and
// any pending schedule is cleared; on failure it is marked failed and rethrows.
export async function applyMigrationNow(mig: MigRow, actorEmail: string, baseUrl: string): Promise<void> {
  if (mig.status !== 'approved') throw badRequest('Only approved migrations can be applied.')
  const conn = await getConnectionSecret(mig.database_id, 'write')
  if (!conn) throw badRequest('No write connection configured.')
  const stmts = (await query<{ sql_text: string }>('SELECT sql_text FROM migration_queries WHERE migration_id = :id ORDER BY ord', { id: mig.id })).map((q) => q.sql_text)
  try {
    await applyStatements(mig.engine, conn, stmts)
  } catch (err) {
    await execute('UPDATE migrations SET status = :s WHERE id = :id', { s: 'failed', id: mig.id })
    await addEvent(mig.id, actorEmail, 'failed', (err as Error).message)
    throw err
  }
  await execute('UPDATE migrations SET status = :s, applied_at = NOW(), scheduled_for = NULL, scheduled_by = NULL WHERE id = :id', { s: 'applied', id: mig.id })
  await addEvent(mig.id, actorEmail, 'apply', null)
  await writeAudit({ actor: { email: actorEmail, name: actorEmail } as SessionUser, orgId: mig.org_id, action: 'migration.apply', entityType: 'migration', entityId: mig.id, entityLabel: mig.title, summary: `Apply migration on ${mig.db_name}` })
  await notifyMigration(mig.org_id, 'apply', mig.id, actorEmail, baseUrl)
}

export function registerMigrations(router: Router) {
  // List (optionally by database or org), scoped to the user's orgs.
  router.get('/api/migrations', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const orgs = await userOrgIds(user.id)
    if (orgs.length === 0) return json([])
    const where = [`p.org_id IN (${orgs.map(() => '?').join(',')})`]
    const params: unknown[] = [...orgs]
    const database = ctx.query.get('database')
    const org = ctx.query.get('org')
    if (database) { where.push('m.database_id = ?'); params.push(database) }
    if (org) { await assertOrgMember(user.id, org); where.push('p.org_id = ?'); params.push(org) }
    const rows = await query<MigRow>(`${MIG_SELECT} WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC`, params)
    return json(await Promise.all(rows.map(fullMigration)))
  })

  router.get('/api/migrations/:id', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    return json(await fullMigration(await loadMig(user.id, ctx.params.id)))
  })

  router.post('/api/migrations', async (ctx: Ctx) => {
    const user = requireCapability(ctx, 'edit')
    const body = await readJson<{ database_id: string; title: string; description: string | null; queries: string[]; submit: boolean }>(ctx.req)
    if (!body.database_id || !body.title?.trim() || !body.queries?.length) throw badRequest('database_id, title and queries are required.')
    const db = await queryOne<{ org_id: string; name: string }>(
      'SELECT p.org_id, d.name FROM `databases` d JOIN projects p ON p.id = d.project_id WHERE d.id = :id',
      { id: body.database_id },
    )
    if (!db) throw badRequest('Unknown database.')
    await assertOrgMember(user.id, db.org_id)

    const id = newId('m')
    const status: MigrationStatus = body.submit ? 'pending_approval' : 'draft'
    await execute('INSERT INTO migrations (id, database_id, title, description, status, author_email) VALUES (:id, :db, :title, :desc, :status, :author)', {
      id, db: body.database_id, title: body.title.trim(), desc: body.description ?? null, status, author: user.email,
    })
    for (let i = 0; i < body.queries.length; i++) {
      await execute('INSERT INTO migration_queries (id, migration_id, ord, sql_text) VALUES (:id, :m, :ord, :sql)', {
        id: newId('q'), m: id, ord: i + 1, sql: body.queries[i],
      })
    }
    await addEvent(id, user.email, 'created', null)
    if (body.submit) await addEvent(id, user.email, 'submitted', null)
    await writeAudit({ actor: user, orgId: db.org_id, action: body.submit ? 'migration.submit' : 'migration.create', entityType: 'migration', entityId: id, entityLabel: body.title.trim(), summary: `${body.submit ? 'Submitted' : 'Created'} migration on ${db.name}` })
    if (body.submit) await notifyMigration(db.org_id, 'submit', id, user.email, env.appBaseUrl || ctx.url.origin)
    return json(await fullMigration(await loadMig(user.id, id)))
  })

  // Lifecycle transitions.
  for (const action of ['submit', 'approve', 'reject', 'apply'] as const) {
    router.post(`/api/migrations/:id/${action}`, async (ctx: Ctx) => {
      const user = requireUser(ctx)
      const mig = await loadMig(user.id, ctx.params.id)
      // Authorization: submit → editor; approve/reject → admin or a designated
      // approver; apply → admin or a designated releaser (both from project settings).
      if (action === 'submit') {
        if (!can(user.role, 'edit')) throw forbidden('Your role does not permit this action.')
      } else if (action === 'apply') {
        const releasers = asJson<string[]>(mig.releasers, [])
        if (!can(user.role, 'approve') && !releasers.includes(user.email)) {
          throw forbidden('Only an admin or a designated releaser can apply this migration.')
        }
      } else {
        const approvers = asJson<string[]>(mig.approvers, [])
        if (!can(user.role, 'approve') && !approvers.includes(user.email)) {
          throw forbidden('Only an admin or a designated approver can approve or reject this migration.')
        }
      }
      const { note } = await readJson<{ note?: string }>(ctx.req).catch(() => ({ note: undefined }))

      // Apply runs the shared helper (records its own event/audit/notification and
      // clears any pending schedule), so return straight away.
      if (action === 'apply') {
        await applyMigrationNow(mig, user.email, env.appBaseUrl || ctx.url.origin)
        return json(await fullMigration(await loadMig(user.id, mig.id)))
      }

      // Set when this approval meets the required-approvals threshold (drives the
      // status flip and the "approved" Slack notification).
      let becameApproved = false

      if (action === 'approve') {
        if (mig.status !== 'pending_approval') throw badRequest('Only migrations pending approval can be approved.')
        // The author may only approve their own migration when the project allows it.
        if (user.email === mig.author_email && !mig.allow_self_approval) {
          throw badRequest('You cannot approve your own migration. Ask another approver, or enable self-approval in project settings.')
        }
        // One approval per person; count distinct approvers (including this one)
        // against the project's required-approvals threshold.
        const [{ mine }] = await query<{ mine: number }>(
          "SELECT COUNT(*) AS mine FROM migration_events WHERE migration_id = :id AND action = 'approve' AND actor_email = :email",
          { id: mig.id, email: user.email },
        )
        if (Number(mine) > 0) throw badRequest('You have already approved this migration.')
        const [{ approvals }] = await query<{ approvals: number }>(
          "SELECT COUNT(DISTINCT actor_email) AS approvals FROM migration_events WHERE migration_id = :id AND action = 'approve'",
          { id: mig.id },
        )
        const required = Math.max(1, Number(mig.required_approvals) || 1)
        if (Number(approvals) + 1 >= required) {
          await execute('UPDATE migrations SET status = :s, approved_by = :by, approved_at = NOW() WHERE id = :id', { s: 'approved', by: user.email, id: mig.id })
          becameApproved = true
        }
        // Otherwise the migration stays pending; this approval is recorded as an event below.
      } else if (action === 'reject') {
        // Pending or already-approved migrations can be rejected; rejecting also
        // clears any pending schedule so a rejected migration never auto-applies.
        if (mig.status !== 'pending_approval' && mig.status !== 'approved') {
          throw badRequest('Only migrations pending approval or approved can be rejected.')
        }
        await execute('UPDATE migrations SET status = :s, scheduled_for = NULL, scheduled_by = NULL WHERE id = :id', { s: 'rejected', id: mig.id })
      } else {
        await execute('UPDATE migrations SET status = :s WHERE id = :id', { s: NEXT_STATUS[action], id: mig.id })
      }
      await addEvent(mig.id, user.email, action, note ?? null)
      await writeAudit({ actor: user, orgId: mig.org_id, action: `migration.${action}`, entityType: 'migration', entityId: mig.id, entityLabel: mig.title, summary: `${action[0].toUpperCase() + action.slice(1)} migration on ${mig.db_name}` })
      // Notify on submit, and on approve only once fully approved (threshold met).
      // (apply notifies from within applyMigrationNow and returns earlier.)
      if (action === 'submit' || (action === 'approve' && becameApproved)) {
        await notifyMigration(mig.org_id, action, mig.id, user.email, env.appBaseUrl || ctx.url.origin)
      }
      return json(await fullMigration(await loadMig(user.id, mig.id)))
    })
  }

  // Schedule an approved migration to auto-apply at a future datetime. Same
  // authority as apply (admin or a designated releaser).
  router.post('/api/migrations/:id/schedule', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const mig = await loadMig(user.id, ctx.params.id)
    const releasers = asJson<string[]>(mig.releasers, [])
    if (!can(user.role, 'approve') && !releasers.includes(user.email)) {
      throw forbidden('Only an admin or a designated releaser can schedule this migration.')
    }
    if (mig.status !== 'approved') throw badRequest('Only approved migrations can be scheduled.')
    const { scheduled_for } = await readJson<{ scheduled_for?: string }>(ctx.req)
    const when = scheduled_for ? new Date(scheduled_for) : null
    if (!when || Number.isNaN(when.getTime())) throw badRequest('A valid scheduled_for datetime is required.')
    if (when.getTime() <= Date.now()) throw badRequest('The scheduled time must be in the future.')
    await execute('UPDATE migrations SET scheduled_for = :t, scheduled_by = :by WHERE id = :id', { t: when, by: user.email, id: mig.id })
    await addEvent(mig.id, user.email, 'scheduled', when.toISOString())
    await writeAudit({ actor: user, orgId: mig.org_id, action: 'migration.schedule', entityType: 'migration', entityId: mig.id, entityLabel: mig.title, summary: `Scheduled migration on ${mig.db_name} for ${when.toISOString()}` })
    return json(await fullMigration(await loadMig(user.id, mig.id)))
  })

  // Cancel a pending schedule (leaves the migration approved).
  router.post('/api/migrations/:id/cancel-schedule', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const mig = await loadMig(user.id, ctx.params.id)
    const releasers = asJson<string[]>(mig.releasers, [])
    if (!can(user.role, 'approve') && !releasers.includes(user.email)) {
      throw forbidden('Only an admin or a designated releaser can cancel this schedule.')
    }
    await execute('UPDATE migrations SET scheduled_for = NULL, scheduled_by = NULL WHERE id = :id', { id: mig.id })
    await addEvent(mig.id, user.email, 'schedule_cancelled', null)
    await writeAudit({ actor: user, orgId: mig.org_id, action: 'migration.cancel_schedule', entityType: 'migration', entityId: mig.id, entityLabel: mig.title, summary: `Cancelled schedule for migration on ${mig.db_name}` })
    return json(await fullMigration(await loadMig(user.id, mig.id)))
  })

  // Reviewers (replace the set).
  router.put('/api/migrations/:id/reviewers', async (ctx: Ctx) => {
    const user = requireCapability(ctx, 'edit')
    const mig = await loadMig(user.id, ctx.params.id)
    const { reviewers } = await readJson<{ reviewers: string[] }>(ctx.req)
    const existing = (await query<{ reviewer_email: string }>('SELECT reviewer_email FROM migration_reviewers WHERE migration_id = :id', { id: mig.id })).map((r) => r.reviewer_email)
    await execute('DELETE FROM migration_reviewers WHERE migration_id = :id', { id: mig.id })
    for (const email of reviewers ?? []) {
      await execute('INSERT IGNORE INTO migration_reviewers (migration_id, reviewer_email) VALUES (:m, :e)', { m: mig.id, e: email })
    }
    const added = (reviewers ?? []).filter((e) => !existing.includes(e))
    if (added.length) await notifyMigration(mig.org_id, 'reviewer', mig.id, user.email, env.appBaseUrl || ctx.url.origin)
    return json(await fullMigration(await loadMig(user.id, mig.id)))
  })

  // Comments (append).
  router.post('/api/migrations/:id/comments', async (ctx: Ctx) => {
    const user = requireCapability(ctx, 'edit')
    const mig = await loadMig(user.id, ctx.params.id)
    const { body } = await readJson<{ body: string }>(ctx.req)
    if (!body?.trim()) throw badRequest('Empty comment.')
    await execute('INSERT INTO migration_comments (id, migration_id, author_email, author_name, body) VALUES (:id, :m, :e, :n, :b)', {
      id: newId('cm'), m: mig.id, e: user.email, n: user.name, b: body.trim(),
    })
    return json(await fullMigration(await loadMig(user.id, mig.id)))
  })
}

// Migrations for a project (used by the project Migrations tab).
export function registerProjectMigrations(router: Router) {
  router.get('/api/projects/:id/migrations', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const proj = await queryOne<{ org_id: string }>('SELECT org_id FROM projects WHERE id = :id', { id: ctx.params.id })
    if (!proj) throw notFound('Project not found')
    await assertOrgMember(user.id, proj.org_id)
    const rows = await query<MigRow>(`${MIG_SELECT} WHERE d.project_id = :pid ORDER BY m.created_at DESC`, { pid: ctx.params.id })
    return json(await Promise.all(rows.map(fullMigration)))
  })
}
