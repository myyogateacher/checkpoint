import { type Router, type Ctx, json, readJson, badRequest } from '../lib/http'
import { requireUser } from '../lib/auth'
import { writeAudit } from '../lib/audit'
import { loadDb, getConnectionSecret } from './databases.repo'
import { runReadQuery, assertReadOnly } from '../lib/externalDb'

export function registerQuery(router: Router) {
  // Run a read-only query against the database's read connection.
  router.post('/api/databases/:id/query', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const db = await loadDb(user.id, ctx.params.id)
    const { sql } = await readJson<{ sql: string; timeout_seconds?: number }>(ctx.req)
    if (!sql?.trim()) throw badRequest('Empty query.')
    // Defense in depth: engine-aware read-only validation before connecting.
    assertReadOnly(db.engine, sql)

    const conn = await getConnectionSecret(db.id, 'read')
    if (!conn) throw badRequest('No read connection configured.')

    const result = await runReadQuery(db.engine, conn, sql)
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
