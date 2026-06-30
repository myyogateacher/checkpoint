import { type Router, type Ctx, json, readJson, badRequest, notFound } from '../lib/http'
import { query, queryOne, execute } from '../db/pool'
import { requireUser, requireCapability, userOrgIds, assertOrgMember } from '../lib/auth'
import { newId } from '../lib/ids'
import { iso } from '../lib/serialize'
import { writeAudit } from '../lib/audit'
import { getConnectionSecret } from './databases.repo'
import { applyStatements } from '../lib/externalDb'
import { notifyMigration } from '../lib/slack'
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
  created_at: Date
}

const MIG_SELECT = `
  SELECT m.*, d.name AS db_name, d.engine, p.org_id
  FROM migrations m
  JOIN \`databases\` d ON d.id = m.database_id
  JOIN projects p ON p.id = d.project_id`

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
    reviewers: reviewers.map((r) => r.reviewer_email),
    queries: queries.map((q) => ({ id: q.id, order: Number(q.ord), sql: q.sql_text })),
    comments: comments.map((c) => ({ id: c.id, author_email: c.author_email, author_name: c.author_name, body: c.body, created_at: iso(c.created_at)! })),
    created_at: iso(row.created_at)!,
    approved_by: row.approved_by,
    approved_at: iso(row.approved_at),
    applied_at: iso(row.applied_at),
    events: events.map((e) => ({ at: iso(e.at)!, actor_email: e.actor_email, action: e.action, note: e.note })),
  }
}

async function loadMig(userId: string, id: string): Promise<MigRow> {
  const row = await queryOne<MigRow>(`${MIG_SELECT} WHERE m.id = :id`, { id })
  if (!row) throw notFound('Migration not found')
  await assertOrgMember(userId, row.org_id)
  return row
}

async function addEvent(migrationId: string, actor: SessionUser, action: string, note: string | null) {
  await execute('INSERT INTO migration_events (id, migration_id, actor_email, action, note) VALUES (:id, :m, :a, :act, :note)', {
    id: newId('ev'), m: migrationId, a: actor.email, act: action, note,
  })
}

const NEXT_STATUS: Record<string, MigrationStatus> = {
  submit: 'pending_approval',
  approve: 'approved',
  reject: 'rejected',
  apply: 'applied',
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
    await addEvent(id, user, 'created', null)
    if (body.submit) await addEvent(id, user, 'submitted', null)
    await writeAudit({ actor: user, orgId: db.org_id, action: body.submit ? 'migration.submit' : 'migration.create', entityType: 'migration', entityId: id, entityLabel: body.title.trim(), summary: `${body.submit ? 'Submitted' : 'Created'} migration on ${db.name}` })
    if (body.submit) await notifyMigration(db.org_id, 'submit', { title: body.title.trim(), database: db.name, actor: user.email })
    return json(await fullMigration(await loadMig(user.id, id)))
  })

  // Lifecycle transitions.
  for (const action of ['submit', 'approve', 'reject', 'apply'] as const) {
    router.post(`/api/migrations/:id/${action}`, async (ctx: Ctx) => {
      // submit is an editor action; approve/reject/apply require approver (admin).
      const user = requireCapability(ctx, action === 'submit' ? 'edit' : 'approve')
      const mig = await loadMig(user.id, ctx.params.id)
      const { note } = await readJson<{ note?: string }>(ctx.req).catch(() => ({ note: undefined }))

      if (action === 'apply') {
        if (mig.status !== 'approved') throw badRequest('Only approved migrations can be applied.')
        const conn = await getConnectionSecret(mig.database_id, 'write')
        if (!conn) throw badRequest('No write connection configured.')
        const stmts = (await query<{ sql_text: string }>('SELECT sql_text FROM migration_queries WHERE migration_id = :id ORDER BY ord', { id: mig.id })).map((q) => q.sql_text)
        try {
          await applyStatements(mig.engine, conn, stmts)
        } catch (err) {
          await execute('UPDATE migrations SET status = :s WHERE id = :id', { s: 'failed', id: mig.id })
          await addEvent(mig.id, user, 'failed', (err as Error).message)
          throw err
        }
        await execute('UPDATE migrations SET status = :s, applied_at = NOW() WHERE id = :id', { s: 'applied', id: mig.id })
      } else if (action === 'approve') {
        // The author may only approve their own migration when the project allows it.
        if (user.email === mig.author_email) {
          const ps = await queryOne<{ allow_self_approval: number }>(
            `SELECT ps.allow_self_approval FROM \`databases\` d
               JOIN project_settings ps ON ps.project_id = d.project_id
              WHERE d.id = :dbid`,
            { dbid: mig.database_id },
          )
          if (!ps?.allow_self_approval) throw badRequest('You cannot approve your own migration. Ask another approver, or enable self-approval in project settings.')
        }
        await execute('UPDATE migrations SET status = :s, approved_by = :by, approved_at = NOW() WHERE id = :id', { s: 'approved', by: user.email, id: mig.id })
      } else {
        await execute('UPDATE migrations SET status = :s WHERE id = :id', { s: NEXT_STATUS[action], id: mig.id })
      }
      await addEvent(mig.id, user, action, note ?? null)
      await writeAudit({ actor: user, orgId: mig.org_id, action: `migration.${action}`, entityType: 'migration', entityId: mig.id, entityLabel: mig.title, summary: `${action[0].toUpperCase() + action.slice(1)} migration on ${mig.db_name}` })
      if (action === 'submit' || action === 'approve' || action === 'apply') {
        await notifyMigration(mig.org_id, action, { title: mig.title, database: mig.db_name, actor: user.email })
      }
      return json(await fullMigration(await loadMig(user.id, mig.id)))
    })
  }

  // Reviewers (replace the set).
  router.put('/api/migrations/:id/reviewers', async (ctx: Ctx) => {
    const user = requireCapability(ctx, 'edit')
    const mig = await loadMig(user.id, ctx.params.id)
    const { reviewers } = await readJson<{ reviewers: string[] }>(ctx.req)
    await execute('DELETE FROM migration_reviewers WHERE migration_id = :id', { id: mig.id })
    for (const email of reviewers ?? []) {
      await execute('INSERT IGNORE INTO migration_reviewers (migration_id, reviewer_email) VALUES (:m, :e)', { m: mig.id, e: email })
    }
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
