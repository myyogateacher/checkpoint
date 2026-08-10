import { type Router, type Ctx, json, readJson, badRequest } from '../lib/http'
import { query, execute } from '../db/pool'
import { requireUser, requireCapability, userOrgIds, assertOrgMember } from '../lib/auth'
import { newId } from '../lib/ids'
import { encryptSecret } from '../lib/crypto'
import { writeAudit } from '../lib/audit'
import { DB_SELECT, loadDb, serializeDb, getConnectionSecret, pullSchema, type DbRow } from './databases.repo'
import { testConnection } from '../lib/externalDb'
import { HttpError } from '../lib/http'

interface ConnInput {
  host: string
  port: number
  username: string
  database: string
  ssl: boolean
  password: string
}

async function upsertConnection(databaseId: string, mode: 'read' | 'write', c: ConnInput, keepPassword = false) {
  const passwordEnc = c.password ? encryptSecret(c.password) : null
  await execute(
    `INSERT INTO connections (id, database_id, mode, host, port, username, db_name, \`ssl\`, password_enc)
     VALUES (:id, :db, :mode, :host, :port, :username, :dbname, :ssl, :pw)
     ON DUPLICATE KEY UPDATE host=:host, port=:port, username=:username, db_name=:dbname, \`ssl\`=:ssl,
       password_enc = ${keepPassword ? 'COALESCE(:pw, password_enc)' : ':pw'}`,
    { id: newId('c'), db: databaseId, mode, host: c.host, port: c.port, username: c.username, dbname: c.database, ssl: c.ssl ? 1 : 0, pw: passwordEnc },
  )
}

// Databases visible to the user, optionally scoped to a project and/or org.
export async function listDatabases(
  userId: string,
  filters: { project?: string | null; org?: string | null } = {},
): Promise<DbRow[]> {
  const orgs = await userOrgIds(userId)
  if (orgs.length === 0) return []
  const where: string[] = [`p.org_id IN (${orgs.map(() => '?').join(',')})`]
  const params: unknown[] = [...orgs]
  if (filters.project) { where.push('d.project_id = ?'); params.push(filters.project) }
  if (filters.org) { await assertOrgMember(userId, filters.org); where.push('p.org_id = ?'); params.push(filters.org) }
  return query<DbRow>(`${DB_SELECT} WHERE ${where.join(' AND ')} ORDER BY d.created_at`, params)
}

export function registerDatabases(router: Router) {
  // List databases, optionally scoped to a project and/or org.
  router.get('/api/databases', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const rows = await listDatabases(user.id, { project: ctx.query.get('project'), org: ctx.query.get('org') })
    return json(await Promise.all(rows.map(serializeDb)))
  })

  router.get('/api/databases/:id', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    return json(await serializeDb(await loadDb(user.id, ctx.params.id)))
  })

  // Create a database with its read & write connections.
  router.post('/api/databases', async (ctx: Ctx) => {
    const user = requireCapability(ctx, 'edit')
    const body = await readJson<{
      project_id: string
      environment_id: string
      name: string
      engine: string
      tags: string[]
      read: ConnInput
      write: ConnInput
    }>(ctx.req)
    if (!body.project_id || !body.name) throw badRequest('project_id and name are required.')
    // Membership is enforced via the project's org.
    const [{ org_id } = { org_id: '' }] = await query<{ org_id: string }>('SELECT org_id FROM projects WHERE id = :id', { id: body.project_id })
    if (!org_id) throw badRequest('Unknown project.')
    await assertOrgMember(user.id, org_id)

    const id = newId('db')
    await execute(
      'INSERT INTO `databases` (id, project_id, environment_id, name, engine, tags) VALUES (:id, :p, :e, :name, :engine, :tags)',
      { id, p: body.project_id, e: body.environment_id, name: body.name, engine: body.engine, tags: JSON.stringify(body.tags ?? []) },
    )
    await upsertConnection(id, 'read', body.read)
    await upsertConnection(id, 'write', body.write)
    await writeAudit({ actor: user, orgId: org_id, action: 'database.create', entityType: 'database', entityId: id, entityLabel: body.name, summary: `Added database ${body.name} (${body.engine})` })

    // Auto-pull the schema so tables show up right after adding, without a manual
    // sync. Best-effort: a bad/unreachable read connection must not fail the create.
    const created = await loadDb(user.id, id)
    try {
      const { tables } = await pullSchema(created)
      await writeAudit({ actor: user, orgId: org_id, action: 'schema.sync', entityType: 'database', entityId: id, entityLabel: body.name, summary: `Pulled schema from ${body.name} — ${tables.length} tables` })
    } catch (err) {
      console.error(`[databases] auto schema pull failed for ${id}: ${(err as Error).message}`)
    }
    return json(await serializeDb(await loadDb(user.id, id)))
  })

  // Validate connection details without saving. Used by the "validate connection"
  // buttons in the add/edit dialogs. When editing an existing connection and the
  // password is left blank, fall back to the stored (decrypted) password.
  router.post('/api/databases/connections/test', async (ctx: Ctx) => {
    const user = requireCapability(ctx, 'edit')
    const body = await readJson<{
      engine: string
      host: string
      port: number
      username: string
      database: string
      ssl: boolean
      password?: string
      database_id?: string
      mode?: 'read' | 'write'
    }>(ctx.req)
    if (!body.engine || !body.host || !body.database) throw badRequest('engine, host and database are required.')

    let password = body.password ?? ''
    if (!password && body.database_id && body.mode) {
      // Membership-check the database before touching its stored secret.
      const db = await loadDb(user.id, body.database_id)
      const stored = await getConnectionSecret(db.id, body.mode)
      password = stored?.password ?? ''
    }

    try {
      const { latencyMs } = await testConnection(body.engine, {
        host: body.host,
        port: Number(body.port),
        username: body.username,
        database: body.database,
        ssl: !!body.ssl,
        password,
      })
      return json({ ok: true, latency_ms: latencyMs })
    } catch (err) {
      // Report the failure inline (200) rather than as an API error.
      const message = err instanceof HttpError ? err.message : (err as Error).message
      return json({ ok: false, error: message })
    }
  })

  // Update one connection (admin only). Empty password keeps the existing one.
  router.put('/api/databases/:id/connections/:mode', async (ctx: Ctx) => {
    const user = requireCapability(ctx, 'manage_users')
    const db = await loadDb(user.id, ctx.params.id)
    const mode = ctx.params.mode === 'write' ? 'write' : 'read'
    const c = await readJson<ConnInput>(ctx.req)
    await upsertConnection(db.id, mode, c, true)
    await writeAudit({ actor: user, orgId: db.org_id, action: 'connection.update', entityType: 'database', entityId: db.id, entityLabel: db.name, summary: `Updated ${mode} connection for ${db.name}` })
    const updated = await serializeDb(await loadDb(user.id, db.id))
    return json(mode === 'read' ? updated.read_connection : updated.write_connection)
  })
}
