import { type Router, type Ctx, json, readJson, badRequest } from '../lib/http'
import { queryOne } from '../db/pool'
import { requireUser } from '../lib/auth'
import { asJson } from '../lib/serialize'
import { writeAudit } from '../lib/audit'
import { loadDb, getConnectionSecret } from './databases.repo'
import { runReadQuery, assertReadOnly } from '../lib/externalDb'

const DEFAULT_TIMEOUT_SECONDS = 30

// The read-panel statement timeout is governed by the org's Settings › Query
// (default_timeout_seconds); resolved server-side so it applies to every query.
async function resolveTimeoutMs(orgId: string): Promise<number> {
  const row = await queryOne<{ query: unknown }>('SELECT query FROM app_settings WHERE org_id = :org', { org: orgId })
  const secs = asJson<{ default_timeout_seconds?: number }>(row?.query, {}).default_timeout_seconds
  return Math.min(300, Math.max(1, Number(secs) || DEFAULT_TIMEOUT_SECONDS)) * 1000
}

export function registerQuery(router: Router) {
  // Run a read-only query against the database's read connection.
  router.post('/api/databases/:id/query', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const db = await loadDb(user.id, ctx.params.id)
    const { sql } = await readJson<{ sql: string }>(ctx.req)
    if (!sql?.trim()) throw badRequest('Empty query.')
    // Defense in depth: engine-aware read-only validation before connecting.
    assertReadOnly(db.engine, sql)

    const conn = await getConnectionSecret(db.id, 'read')
    if (!conn) throw badRequest('No read connection configured.')

    const timeoutMs = await resolveTimeoutMs(db.org_id)
    const result = await runReadQuery(db.engine, conn, sql, timeoutMs)
    const oneLine = sql.replace(/\s+/g, ' ').trim()
    await writeAudit({
      actor: user,
      orgId: db.org_id,
      action: 'query.read',
      entityType: 'database',
      entityId: db.id,
      entityLabel: db.name,
      summary: `Ran read query on ${db.name} — ${oneLine.slice(0, 80)}${oneLine.length > 80 ? '…' : ''}`,
    })
    return json(result)
  })
}
