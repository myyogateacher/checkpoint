import { type Router, type Ctx, json } from '../lib/http'
import { queryOne } from '../db/pool'
import { requireUser, requireCapability } from '../lib/auth'
import { asJson, iso } from '../lib/serialize'
import { writeAudit } from '../lib/audit'
import { loadDb, pullSchema } from './databases.repo'

// The cached schema snapshot for a database the user may see, or null when it has
// never been synced. Never connects to the database — snapshot only.
export async function getDatabaseSchema(userId: string, databaseId: string) {
  await loadDb(userId, databaseId)
  const row = await queryOne<{ synced_at: Date; payload: unknown }>(
    'SELECT synced_at, payload FROM schema_snapshots WHERE database_id = :id',
    { id: databaseId },
  )
  if (!row) return null
  // Table engines store an array of tables; keyspace engines (Redis) `{ keyspace }`.
  const payload = asJson<unknown>(row.payload, [])
  if (Array.isArray(payload)) return { database_id: databaseId, synced_at: iso(row.synced_at), tables: payload }
  return { database_id: databaseId, synced_at: iso(row.synced_at), tables: [], keyspace: (payload as { keyspace?: unknown }).keyspace }
}

export function registerSchema(router: Router) {
  // Latest cached schema snapshot (or null when never synced).
  router.get('/api/databases/:id/schema', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    return json(await getDatabaseSchema(user.id, ctx.params.id))
  })

  // Pull the schema from the database via its read connection.
  router.post('/api/databases/:id/schema/sync', async (ctx: Ctx) => {
    const user = requireCapability(ctx, 'edit')
    const db = await loadDb(user.id, ctx.params.id)

    const { tables, keyspace, syncedAt } = await pullSchema(db)
    const what = keyspace ? `Scanned keys in ${db.name} — ${keyspace.total_keys} keys` : `Pulled schema from ${db.name} — ${tables.length} tables`
    await writeAudit({ actor: user, orgId: db.org_id, action: 'schema.sync', entityType: 'database', entityId: db.id, entityLabel: db.name, summary: what })
    return json({ database_id: db.id, synced_at: syncedAt.toISOString(), tables, ...(keyspace ? { keyspace } : {}) })
  })
}
