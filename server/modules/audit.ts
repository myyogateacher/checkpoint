import { type Router, type Ctx, badRequest, json } from '../lib/http'
import { query, queryOne } from '../db/pool'
import { requireUser, userOrgIds } from '../lib/auth'
import { iso } from '../lib/serialize'
import { limitClause, likeTerm, parsePageParams } from '../lib/paging'
import type { AuditCategoryCounts } from '../types'

interface AuditRow {
  id: string
  actor_email: string
  actor_name: string | null
  action: string
  entity_type: string
  entity_id: string | null
  entity_label: string
  summary: string
  created_at: Date
}

export const AUDIT_MAX_LIMIT = 500

// Audit events across the user's organizations, newest first.
export async function listAuditEvents(userId: string, limit = AUDIT_MAX_LIMIT): Promise<AuditRow[]> {
  const orgs = await userOrgIds(userId)
  if (orgs.length === 0) return []
  // LIMIT is interpolated, so clamp it to a positive integer rather than trusting it.
  const capped = Math.min(AUDIT_MAX_LIMIT, Math.max(1, Math.floor(Number(limit) || AUDIT_MAX_LIMIT)))
  return query<AuditRow>(
    `SELECT id, actor_email, actor_name, action, entity_type, entity_id, entity_label, summary, created_at
       FROM audit_logs WHERE org_id IN (${orgs.map(() => '?').join(',')})
      ORDER BY created_at DESC LIMIT ${capped}`,
    orgs,
  )
}

export function toAuditEvent(r: AuditRow) {
  return {
    id: r.id,
    actor_email: r.actor_email,
    actor_name: r.actor_name,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    entity_label: r.entity_label,
    summary: r.summary,
    created_at: iso(r.created_at)!,
  }
}

// --- Filtering ---------------------------------------------------------------

export type AuditCategory = 'system' | 'migration' | 'manual'

// SQL mirror of auditCategory() in src/lib/format.ts — the two must agree, or a
// pill's count and its page of rows would disagree. `system` is the complement
// of the other two, so every row lands in exactly one category.
const MIGRATION_PREFIX = "a.action LIKE 'migration.%'"
const MANUAL_PREFIX = "(a.action LIKE 'schema.%' OR a.action LIKE 'query.%')"

export const CATEGORY_SQL: Record<AuditCategory, string> = {
  migration: MIGRATION_PREFIX,
  manual: MANUAL_PREFIX,
  system: `NOT (${MIGRATION_PREFIX} OR ${MANUAL_PREFIX})`,
}

export function isAuditCategory(value: string | null | undefined): value is AuditCategory {
  return value === 'system' || value === 'migration' || value === 'manual'
}

export interface AuditFilters {
  category?: string | null
  q?: string | null
  // actor_email exactly as stored — the client picks it from a list, never types it.
  actor?: string | null
  // Environment NAME, not id: environments are per-project, so "production"
  // exists once per project and filtering by id would only ever match one of them.
  environment?: string | null
  database?: string | null
  from?: Date | null
  // Exclusive. The client sends the start of the day after the one the user picked,
  // so the end date is fully included without depending on the column's precision.
  to?: Date | null
}

// audit_logs carries no database_id. A row names either a database directly
// (entity_type = 'database') or a migration that is one hop from its database,
// and the remaining entity types (project, user, api_token) have no database at
// all — those rows get NULL here and drop out of both filters, which is right.
// The join is added only when a database or environment filter is set, so every
// other request keeps its single-table plan on the (org_id, created_at) index;
// audit_logs only ever grows, so paying for the join unconditionally never gets
// better. Each ON matches a primary key, so no row is duplicated and COUNT(*)
// stays exact.
const DATABASE_JOIN =
  " LEFT JOIN migrations m ON a.entity_type = 'migration' AND m.id = a.entity_id" +
  " LEFT JOIN `databases` d ON d.id = IF(a.entity_type = 'database', a.entity_id, m.database_id)"
const ENVIRONMENT_JOIN = `${DATABASE_JOIN} LEFT JOIN environments e ON e.id = d.environment_id`

// Scope to the user's orgs plus every optional filter the page offers: category,
// search, actor, database, environment and the created_at range. Returns null when
// the user belongs to no org (nothing to select).
async function auditScope(
  userId: string,
  filters: AuditFilters,
  opts: { category?: boolean } = {},
): Promise<{ join: string; where: string; params: unknown[] } | null> {
  const orgs = await userOrgIds(userId)
  if (orgs.length === 0) return null
  const where = [`a.org_id IN (${orgs.map(() => '?').join(',')})`]
  const params: unknown[] = [...orgs]
  let join = ''
  if (opts.category !== false && isAuditCategory(filters.category)) where.push(CATEGORY_SQL[filters.category])
  if (filters.actor) {
    where.push('a.actor_email = ?')
    params.push(filters.actor)
  }
  if (filters.database) {
    join = DATABASE_JOIN
    where.push('d.id = ?')
    params.push(filters.database)
  }
  if (filters.environment) {
    // Superset of DATABASE_JOIN, so setting both filters still joins once.
    join = ENVIRONMENT_JOIN
    where.push('e.name = ?')
    params.push(filters.environment)
  }
  // Bound as Date objects on purpose. created_at is a naive DATETIME, and mysql2
  // (timezone 'local', the default) converts both ways in the process timezone,
  // which package.json pins to TZ=UTC on every start script. So the same frame
  // that iso() reads a row back out in is the one these bounds are written in.
  // A pre-formatted string here would be a second frame, and a row the list
  // renders inside the range could then be excluded by the range that selected it.
  if (filters.from) {
    where.push('a.created_at >= ?')
    params.push(filters.from)
  }
  if (filters.to) {
    where.push('a.created_at < ?')
    params.push(filters.to)
  }
  const q = filters.q?.trim()
  if (q) {
    // ESCAPE '\\' is a single backslash in SQL: a % or _ the user typed matches
    // literally instead of turning the search into a wildcard.
    where.push(
      "(a.summary LIKE ? ESCAPE '\\\\' OR a.actor_email LIKE ? ESCAPE '\\\\' " +
        "OR a.entity_label LIKE ? ESCAPE '\\\\' OR a.action LIKE ? ESCAPE '\\\\')",
    )
    params.push(...Array<string>(4).fill(likeTerm(q)))
  }
  return { join, where: where.join(' AND '), params }
}

const AUDIT_COLUMNS =
  'a.id, a.actor_email, a.actor_name, a.action, a.entity_type, a.entity_id, a.entity_label, a.summary, a.created_at'

// A filtered slice of the audit log, newest first.
export async function listAuditPage(
  userId: string,
  filters: AuditFilters & { limit?: number; offset?: number } = {},
): Promise<AuditRow[]> {
  const scope = await auditScope(userId, filters)
  if (!scope) return []
  return query<AuditRow>(
    `SELECT ${AUDIT_COLUMNS} FROM audit_logs a${scope.join} WHERE ${scope.where}
      ORDER BY a.created_at DESC${limitClause(filters.limit, filters.offset)}`,
    scope.params,
  )
}

export async function countAuditEvents(userId: string, filters: AuditFilters = {}): Promise<number> {
  const scope = await auditScope(userId, filters)
  if (!scope) return 0
  const row = await queryOne<{ n: number | string }>(
    `SELECT COUNT(*) AS n FROM audit_logs a${scope.join} WHERE ${scope.where}`,
    scope.params,
  )
  return Number(row?.n ?? 0)
}

// Per-category counts honoring every filter except category, so the pills show what
// the current actor/environment/database/date/search selection holds while one
// category is selected.
export async function auditCategoryCounts(userId: string, filters: AuditFilters = {}): Promise<AuditCategoryCounts> {
  const counts: AuditCategoryCounts = { all: 0, system: 0, migration: 0, manual: 0 }
  const scope = await auditScope(userId, filters, { category: false })
  if (!scope) return counts
  // One pass, bucketed by the same prefix rules the category filter uses.
  const row = await queryOne<Record<string, number | string>>(
    `SELECT COUNT(*) AS all_n,
            SUM(${CATEGORY_SQL.migration}) AS migration_n,
            SUM(${CATEGORY_SQL.manual}) AS manual_n,
            SUM(${CATEGORY_SQL.system}) AS system_n
       FROM audit_logs a${scope.join} WHERE ${scope.where}`,
    scope.params,
  )
  counts.all = Number(row?.all_n ?? 0)
  counts.migration = Number(row?.migration_n ?? 0)
  counts.manual = Number(row?.manual_n ?? 0)
  counts.system = Number(row?.system_n ?? 0)
  return counts
}

// A range bound arrives as an absolute instant (the client turns the day the user
// picked into one, in the viewer's zone). Garbage is a 400 rather than a silent
// drop: showing an unfiltered page under a filled-in date field reads as "there
// is nothing in that range", which is the opposite of what happened.
function parseInstant(raw: string | null, field: string): Date | null {
  if (!raw) return null
  const at = new Date(raw)
  if (Number.isNaN(at.getTime())) throw badRequest(`${field} must be an ISO date-time.`)
  return at
}

// System-wide audit log, scoped to the user's organizations. With `page` /
// `page_size` the response is a paginated envelope; without them it stays the
// plain (capped) array every existing caller expects.
export function registerAudit(router: Router) {
  router.get('/api/audit-logs', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const paging = parsePageParams(ctx.query)
    if (!paging) {
      const rows = await listAuditEvents(user.id)
      return json(rows.map(toAuditEvent))
    }
    const filters: AuditFilters = {
      category: ctx.query.get('category'),
      q: ctx.query.get('q'),
      actor: ctx.query.get('actor'),
      environment: ctx.query.get('environment'),
      database: ctx.query.get('database'),
      from: parseInstant(ctx.query.get('from'), 'from'),
      to: parseInstant(ctx.query.get('to'), 'to'),
    }
    const { page, pageSize } = paging
    const [rows, total, counts] = await Promise.all([
      listAuditPage(user.id, { ...filters, limit: pageSize, offset: (page - 1) * pageSize }),
      countAuditEvents(user.id, filters),
      auditCategoryCounts(user.id, filters),
    ])
    return json({ items: rows.map(toAuditEvent), total, page, page_size: pageSize, counts })
  })
}
