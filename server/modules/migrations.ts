import { type Router, type Ctx, json, readJson, badRequest, notFound, forbidden, conflict } from '../lib/http'
import { query, queryOne, execute, transaction } from '../db/pool'
import { requireUser, requireCapability, can, userOrgIds, assertOrgMember } from '../lib/auth'
import { newId } from '../lib/ids'
import { iso, asJson } from '../lib/serialize'
import { writeAudit } from '../lib/audit'
import { getConnectionSecret } from './databases.repo'
import { applyStatements } from '../lib/externalDb'
import { notifyMigration } from '../lib/slack'
import { checkSyntax } from '../lib/sqlSyntax'
import { env } from '../env'
import type { MigrationStatus, SessionUser } from '../types'

// Sentinel stored in a project's approvers/releasers/self-approvers lists meaning
// "any org member" (mirrors ALL_USERS on the client). Migrations are only loaded
// after an org-membership check, so reaching an action already implies membership.
const ALL_USERS = '*'

// Whether `user` may release (apply/schedule) a migration given the project's
// releasers list. Admins/approvers always can; otherwise the user must be listed,
// or the list must contain the ALL_USERS sentinel. Deployment (deploy-gated)
// migrations are released only by an admin or deployer — the list is not honored.
export function canRelease(deployGated: boolean, releasers: string[], user: SessionUser): boolean {
  if (deployGated) return can(user.role, 'apply_gated')
  return can(user.role, 'approve') || releasers.includes(ALL_USERS) || releasers.includes(user.email)
}

// Whether an author may approve their own migration: they must be listed in the
// project's self-approvers, or the list must contain the ALL_USERS sentinel. This
// only lifts the "can't approve your own" restriction — the approver
// authorization check (role or approvers list) still applies.
export function canSelfApprove(selfApprovers: string[], userEmail: string): boolean {
  return selfApprovers.includes(ALL_USERS) || selfApprovers.includes(userEmail)
}

// 403 for a failed release check, worded for the migration's kind.
function releaseDenied(mig: MigRow, verb: string) {
  return forbidden(mig.deploy_gated
    ? `Only an admin or deployer can ${verb} a deployment migration.`
    : `Only an admin or a designated releaser can ${verb} this migration.`)
}

// Approval threshold semantics: no settings row → the default of 1; an explicit
// 0 means "no approval needed" and must not be coerced up.
function requiredApprovals(v: number | null | undefined): number {
  return v == null ? 1 : Math.max(0, Number(v))
}

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
  deploy_gated: number
  approved_by: string | null
  approved_at: Date | null
  applied_at: Date | null
  scheduled_for: Date | null
  scheduled_by: string | null
  created_at: Date
  approvers: unknown
  releasers: unknown
  required_approvals: number | null
  self_approvers: unknown
}

// Governance is resolved per environment: a project_env_settings row for the
// database's environment overrides the project-wide project_settings row.
const MIG_SELECT = `
  SELECT m.*, d.name AS db_name, d.engine, p.org_id,
         COALESCE(pes.approvers, ps.approvers) AS approvers,
         COALESCE(pes.releasers, ps.releasers) AS releasers,
         COALESCE(pes.required_approvals, ps.required_approvals) AS required_approvals,
         COALESCE(pes.self_approvers, ps.self_approvers) AS self_approvers
  FROM migrations m
  JOIN \`databases\` d ON d.id = m.database_id
  JOIN projects p ON p.id = d.project_id
  LEFT JOIN project_settings ps ON ps.project_id = p.id
  LEFT JOIN project_env_settings pes ON pes.project_id = p.id AND pes.environment_id = d.environment_id`

export async function fullMigration(row: MigRow) {
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
    deploy_gated: !!row.deploy_gated,
    approvers: asJson<string[]>(row.approvers, []),
    releasers: asJson<string[]>(row.releasers, []),
    required_approvals: requiredApprovals(row.required_approvals),
    self_approvers: asJson<string[]>(row.self_approvers, []),
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

export async function loadMig(userId: string, id: string): Promise<MigRow> {
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
    // Notify Slack of the failure (threaded reply with the full error). Guarded so a
    // notification hiccup can never mask the real apply error we must rethrow.
    try {
      await notifyMigration(mig.org_id, 'failed', mig.id, actorEmail, baseUrl, (err as Error).message)
    } catch (notifyErr) {
      console.error(`[slack] failed-apply notification error: ${(notifyErr as Error).message}`)
    }
    throw err
  }
  await execute('UPDATE migrations SET status = :s, applied_at = NOW(), scheduled_for = NULL, scheduled_by = NULL WHERE id = :id', { s: 'applied', id: mig.id })
  await addEvent(mig.id, actorEmail, 'apply', null)
  await writeAudit({ actor: { email: actorEmail, name: actorEmail } as SessionUser, orgId: mig.org_id, action: 'migration.apply', entityType: 'migration', entityId: mig.id, entityLabel: mig.title, summary: `Apply migration on ${mig.db_name}` })
  await notifyMigration(mig.org_id, 'apply', mig.id, actorEmail, baseUrl)
}

// List migrations visible to the user, optionally filtered. Shared by
// GET /api/migrations and the MCP list_migrations tool.
export async function listMigrations(
  userId: string,
  filters: { database?: string | null; org?: string | null; status?: string | null } = {},
): Promise<MigRow[]> {
  const orgs = await userOrgIds(userId)
  if (orgs.length === 0) return []
  const where = [`p.org_id IN (${orgs.map(() => '?').join(',')})`]
  const params: unknown[] = [...orgs]
  if (filters.database) { where.push('m.database_id = ?'); params.push(filters.database) }
  if (filters.org) { await assertOrgMember(userId, filters.org); where.push('p.org_id = ?'); params.push(filters.org) }
  if (filters.status) { where.push('m.status = ?'); params.push(filters.status) }
  return query<MigRow>(`${MIG_SELECT} WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC`, params)
}

export interface CreateMigrationInput {
  database_id: string
  title: string
  description?: string | null
  queries: string[]
  submit?: boolean
  deploy_gated?: boolean
  reviewers?: string[]
}

// Open a migration (optionally submitting it). Shared by POST /api/migrations and
// the MCP create_migration tool.
//
// `via` is appended to the audit summary to attribute the call (API token, MCP).
// `refuseAutoApprove` is set by non-interactive principals: when the project
// requires 0 approvals a submit would land straight in `approved` without any
// human in the loop, so those callers must submit from the UI instead.
export async function createMigration(
  user: SessionUser,
  input: CreateMigrationInput,
  opts: { baseUrl: string; via?: string; refuseAutoApprove?: boolean },
) {
  if (!input.database_id || !input.title?.trim() || !input.queries?.length) {
    throw badRequest('database_id, title and queries are required.')
  }
  const db = await queryOne<{ org_id: string; name: string; engine: string; required_approvals: number | null }>(
    `SELECT p.org_id, d.name, d.engine,
            COALESCE(pes.required_approvals, ps.required_approvals) AS required_approvals
       FROM \`databases\` d
       JOIN projects p ON p.id = d.project_id
       LEFT JOIN project_settings ps ON ps.project_id = p.id
       LEFT JOIN project_env_settings pes ON pes.project_id = p.id AND pes.environment_id = d.environment_id
      WHERE d.id = :id`,
    { id: input.database_id },
  )
  if (!db) throw badRequest('Unknown database.')
  await assertOrgMember(user.id, db.org_id)

  // Reject statements that don't parse for the target engine (engines without
  // a grammar are skipped). The client runs the same check for inline feedback.
  for (let i = 0; i < input.queries.length; i++) {
    const syntaxError = checkSyntax(input.queries[i].trim(), db.engine)
    if (syntaxError) throw badRequest(`Statement ${i + 1}: ${syntaxError}`)
  }

  // When the project requires 0 approvals, a submitted migration is approved
  // immediately (ready to release) rather than waiting in pending_approval.
  const required = requiredApprovals(db.required_approvals)
  const autoApproved = !!input.submit && required === 0
  if (autoApproved && opts.refuseAutoApprove) {
    throw forbidden(
      'This project requires 0 approvals, so submitting would approve the migration outright. ' +
        'Create it as a draft (submit: false) and submit it from the Checkpoint UI.',
    )
  }
  const id = newId('m')
  const status: MigrationStatus = !input.submit ? 'draft' : autoApproved ? 'approved' : 'pending_approval'
  await execute('INSERT INTO migrations (id, database_id, title, description, status, author_email, deploy_gated) VALUES (:id, :db, :title, :desc, :status, :author, :gated)', {
    id, db: input.database_id, title: input.title.trim(), desc: input.description ?? null, status, author: user.email, gated: input.deploy_gated ? 1 : 0,
  })
  if (autoApproved) await execute('UPDATE migrations SET approved_at = NOW() WHERE id = :id', { id })
  for (let i = 0; i < input.queries.length; i++) {
    await execute('INSERT INTO migration_queries (id, migration_id, ord, sql_text) VALUES (:id, :m, :ord, :sql)', {
      id: newId('q'), m: id, ord: i + 1, sql: input.queries[i],
    })
  }
  // Reviewers picked at creation; tagged in the submit notification rather than
  // sent a separate "reviewer added" alert.
  for (const email of input.reviewers ?? []) {
    if (!email?.trim()) continue
    await execute('INSERT IGNORE INTO migration_reviewers (migration_id, reviewer_email) VALUES (:m, :e)', { m: id, e: email.trim() })
  }
  await addEvent(id, user.email, 'created', null)
  if (input.submit) await addEvent(id, user.email, 'submitted', null)
  if (autoApproved) await addEvent(id, user.email, 'approve', 'Auto-approved — project requires no approvals.')
  const via = opts.via ?? ''
  await writeAudit({ actor: user, orgId: db.org_id, action: input.submit ? 'migration.submit' : 'migration.create', entityType: 'migration', entityId: id, entityLabel: input.title.trim(), summary: `${input.submit ? 'Submitted' : 'Created'} migration on ${db.name}${via}` })
  if (input.submit) await notifyMigration(db.org_id, 'submit', id, user.email, opts.baseUrl)
  if (autoApproved) await notifyMigration(db.org_id, 'approve', id, user.email, opts.baseUrl)
  return fullMigration(await loadMig(user.id, id))
}

export interface EditMigrationInput {
  title: string
  description?: string | null
  queries: string[]
  deploy_gated?: boolean
}

// Who may edit a draft: its author, or anyone with the `edit` capability — the
// same "edit/author" authority POST /api/migrations/:id/submit applies.
export function canEditMigration(user: SessionUser, authorEmail: string): boolean {
  return user.email === authorEmail || can(user.role, 'edit')
}

// Everything PATCH /api/migrations/:id can reject without touching the database:
// authority, the draft-only rule, and the same body validation create runs
// (title required, at least one non-empty statement, every statement parses for
// the engine — which is where multi-statement blocks are refused).
export function assertCanEditDraft(
  user: SessionUser,
  mig: { status: MigrationStatus; author_email: string; engine: string },
  input: EditMigrationInput | null | undefined,
): void {
  if (!canEditMigration(user, mig.author_email)) throw forbidden('Your role does not permit this action.')
  if (mig.status !== 'draft') throw conflict('Only draft migrations can be edited')
  if (!input?.title?.trim() || !input.queries?.length || !input.queries.some((q) => q?.trim())) {
    throw badRequest('title and queries are required.')
  }
  for (let i = 0; i < input.queries.length; i++) {
    const syntaxError = checkSyntax((input.queries[i] ?? '').trim(), mig.engine)
    if (syntaxError) throw badRequest(`Statement ${i + 1}: ${syntaxError}`)
  }
}

// Append a comment to a migration. Shared by POST /api/migrations/:id/comments
// and the MCP add_migration_comment tool. Comments are append-only.
export async function addMigrationComment(user: SessionUser, migrationId: string, body: string) {
  const mig = await loadMig(user.id, migrationId)
  if (!body?.trim()) throw badRequest('Empty comment.')
  await execute('INSERT INTO migration_comments (id, migration_id, author_email, author_name, body) VALUES (:id, :m, :e, :n, :b)', {
    id: newId('cm'), m: mig.id, e: user.email, n: user.name, b: body.trim(),
  })
  return fullMigration(await loadMig(user.id, mig.id))
}

// Governance verbs — the review-flow actions on an existing migration: moving it
// through the lifecycle, releasing it, or changing who reviews it. These are the
// actions that let SQL reach a real database (or decide who vouches for it), and
// they are deliberately reachable only by a human in a browser session.
//
// `submit` is included: on a project requiring 0 approvals a submit flips the
// migration straight to approved, and even where it doesn't, advancing someone
// else's migration into review is a human call. Note this is the *standalone*
// submit of an existing migration — creating a migration already submitted
// (POST /api/migrations, MCP create_migration) is a separate, permitted action.
export const GOVERNANCE_ACTIONS = [
  'submit',
  'approve',
  'reject',
  'apply',
  'schedule',
  'cancel-schedule',
  'reviewers',
] as const
export type GovernanceAction = (typeof GOVERNANCE_ACTIONS)[number]

// How each refusal reads. An exhaustive Record, so adding a governance action
// without giving it a message is a type error.
const GOVERNANCE_REFUSAL: Record<GovernanceAction, string> = {
  submit: 'Migrations cannot be submitted',
  approve: 'Migrations cannot be approved',
  reject: 'Migrations cannot be rejected',
  apply: 'Migrations cannot be applied',
  schedule: 'Migrations cannot be scheduled',
  'cancel-schedule': 'Migration schedules cannot be cancelled',
  reviewers: 'Migration reviewers cannot be changed',
}

export function isGovernanceAction(action: string): action is GovernanceAction {
  return (GOVERNANCE_ACTIONS as readonly string[]).includes(action)
}

// INVARIANT: no API-token principal may ever perform a governance verb — not over
// REST, not over MCP, no scope and no role grants it. The Bearer allowlist
// (TOKEN_ROUTES) already keeps these routes session-only and the MCP module
// registers no tools for them; this is the last line of defense, enforced at the
// point of action so a future routing or tool mistake still cannot approve or
// apply a migration. Do not weaken it without changing the product decision.
export function assertNotTokenPrincipal(ctx: Ctx, action: string): void {
  if (!ctx.apiToken || !isGovernanceAction(action)) return
  throw forbidden(
    `${GOVERNANCE_REFUSAL[action]} with an API token or over MCP. ` +
      'Sign in to Checkpoint and act on the migration there.',
  )
}

export function registerMigrations(router: Router) {
  // List (optionally by database or org), scoped to the user's orgs.
  router.get('/api/migrations', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const rows = await listMigrations(user.id, {
      database: ctx.query.get('database'),
      org: ctx.query.get('org'),
    })
    return json(await Promise.all(rows.map(fullMigration)))
  })

  router.get('/api/migrations/:id', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    return json(await fullMigration(await loadMig(user.id, ctx.params.id)))
  })

  router.post('/api/migrations', async (ctx: Ctx) => {
    const user = requireCapability(ctx, 'edit')
    const body = await readJson<CreateMigrationInput>(ctx.req)
    // Token-authenticated creates are called out in the audit trail. They also
    // cannot ride the 0-approval auto-approve path: that would be a token
    // approving a migration, which no token may ever do.
    const via = ctx.apiToken ? ` via API token "${ctx.apiToken.name}"` : ''
    return json(
      await createMigration(user, body, {
        baseUrl: env.appBaseUrl || ctx.url.origin,
        via,
        refuseAutoApprove: !!ctx.apiToken,
      }),
    )
  })

  // Edit a draft: replaces title/description/deploy_gated and the whole query
  // list. Drafts only — once a migration is in review its statements are what
  // approvers vouched for, so later changes go through a new migration.
  router.patch('/api/migrations/:id', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const mig = await loadMig(user.id, ctx.params.id)
    const body = await readJson<EditMigrationInput>(ctx.req)
    assertCanEditDraft(user, mig, body)
    const title = body.title.trim()
    // Queries are replaced wholesale, so the delete and the re-insert must land
    // together — a half-applied edit would leave the draft without its SQL.
    await transaction(async (tx) => {
      await tx.execute(
        'UPDATE migrations SET title = :title, description = :desc, deploy_gated = :gated WHERE id = :id',
        {
          title,
          desc: body.description ?? null,
          gated: (body.deploy_gated ?? !!mig.deploy_gated) ? 1 : 0,
          id: mig.id,
        },
      )
      await tx.execute('DELETE FROM migration_queries WHERE migration_id = :id', { id: mig.id })
      for (let i = 0; i < body.queries.length; i++) {
        await tx.execute('INSERT INTO migration_queries (id, migration_id, ord, sql_text) VALUES (:id, :m, :ord, :sql)', {
          id: newId('q'), m: mig.id, ord: i + 1, sql: body.queries[i],
        })
      }
    })
    await addEvent(mig.id, user.email, 'edited', null)
    const via = ctx.apiToken ? ` via API token "${ctx.apiToken.name}"` : ''
    await writeAudit({ actor: user, orgId: mig.org_id, action: 'migration.edit', entityType: 'migration', entityId: mig.id, entityLabel: title, summary: `Edited draft migration on ${mig.db_name}${via}` })
    return json(await fullMigration(await loadMig(user.id, mig.id)))
  })

  // Lifecycle transitions.
  for (const action of ['submit', 'approve', 'reject', 'apply'] as const) {
    router.post(`/api/migrations/:id/${action}`, async (ctx: Ctx) => {
      assertNotTokenPrincipal(ctx, action)
      const user = requireUser(ctx)
      const mig = await loadMig(user.id, ctx.params.id)
      // Authorization: submit → editor; approve/reject → admin or a designated
      // approver; apply → admin or a designated releaser (both from project settings).
      if (action === 'submit') {
        // Token principals never get here — assertNotTokenPrincipal above covers
        // submit, which matters most on a 0-approval project where a submit
        // approves the migration outright.
        if (!can(user.role, 'edit')) throw forbidden('Your role does not permit this action.')
      } else if (action === 'apply') {
        if (!canRelease(!!mig.deploy_gated, asJson<string[]>(mig.releasers, []), user)) {
          throw releaseDenied(mig, 'apply')
        }
      } else {
        const approvers = asJson<string[]>(mig.approvers, [])
        if (!can(user.role, 'approve') && !approvers.includes(ALL_USERS) && !approvers.includes(user.email)) {
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
        // The author may only approve their own migration when granted self-approval.
        if (user.email === mig.author_email && !canSelfApprove(asJson<string[]>(mig.self_approvers, []), user.email)) {
          throw badRequest('You cannot approve your own migration. Ask another approver, or ask an admin to grant you self-approval in project settings.')
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
        const required = requiredApprovals(mig.required_approvals)
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
        // submit: when the project requires 0 approvals, go straight to approved.
        const required = requiredApprovals(mig.required_approvals)
        if (required === 0) {
          await execute('UPDATE migrations SET status = :s, approved_at = NOW() WHERE id = :id', { s: 'approved', id: mig.id })
          becameApproved = true
        } else {
          await execute('UPDATE migrations SET status = :s WHERE id = :id', { s: NEXT_STATUS[action], id: mig.id })
        }
      }
      await addEvent(mig.id, user.email, action, note ?? null)
      if (action === 'submit' && becameApproved) await addEvent(mig.id, user.email, 'approve', 'Auto-approved — project requires no approvals.')
      await writeAudit({ actor: user, orgId: mig.org_id, action: `migration.${action}`, entityType: 'migration', entityId: mig.id, entityLabel: mig.title, summary: `${action[0].toUpperCase() + action.slice(1)} migration on ${mig.db_name}` })
      // Notify on submit, and on approve once fully approved (threshold met, incl.
      // a 0-approval auto-approve). (apply notifies from applyMigrationNow above.)
      if (action === 'submit') {
        await notifyMigration(mig.org_id, 'submit', mig.id, user.email, env.appBaseUrl || ctx.url.origin)
      }
      if (becameApproved) {
        await notifyMigration(mig.org_id, 'approve', mig.id, user.email, env.appBaseUrl || ctx.url.origin)
      }
      if (action === 'reject') {
        // Threaded rejection alert with the reject note as the reason, if given.
        await notifyMigration(mig.org_id, 'reject', mig.id, user.email, env.appBaseUrl || ctx.url.origin, note ?? null)
      }
      return json(await fullMigration(await loadMig(user.id, mig.id)))
    })
  }

  // Schedule an approved migration to auto-apply at a future datetime. Same
  // authority as apply (admin or a designated releaser).
  router.post('/api/migrations/:id/schedule', async (ctx: Ctx) => {
    assertNotTokenPrincipal(ctx, 'schedule')
    const user = requireUser(ctx)
    const mig = await loadMig(user.id, ctx.params.id)
    if (!canRelease(!!mig.deploy_gated, asJson<string[]>(mig.releasers, []), user)) {
      throw releaseDenied(mig, 'schedule')
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
    assertNotTokenPrincipal(ctx, 'cancel-schedule')
    const user = requireUser(ctx)
    const mig = await loadMig(user.id, ctx.params.id)
    if (!canRelease(!!mig.deploy_gated, asJson<string[]>(mig.releasers, []), user)) {
      throw releaseDenied(mig, 'cancel the schedule for')
    }
    await execute('UPDATE migrations SET scheduled_for = NULL, scheduled_by = NULL WHERE id = :id', { id: mig.id })
    await addEvent(mig.id, user.email, 'schedule_cancelled', null)
    await writeAudit({ actor: user, orgId: mig.org_id, action: 'migration.cancel_schedule', entityType: 'migration', entityId: mig.id, entityLabel: mig.title, summary: `Cancelled schedule for migration on ${mig.db_name}` })
    return json(await fullMigration(await loadMig(user.id, mig.id)))
  })

  // Reviewers (replace the set).
  router.put('/api/migrations/:id/reviewers', async (ctx: Ctx) => {
    // Who vouches for a change is a human call about accountability, so this is a
    // governance verb: no token principal may reassign reviewers.
    assertNotTokenPrincipal(ctx, 'reviewers')
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
    const { body } = await readJson<{ body: string }>(ctx.req)
    return json(await addMigrationComment(user, ctx.params.id, body))
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
