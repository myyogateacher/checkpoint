import { type Router, type Ctx, json, readJson, badRequest } from '../lib/http'
import { query, execute } from '../db/pool'
import { requireUser, requireCapability, userOrgIds, assertOrgMember } from '../lib/auth'
import { newId } from '../lib/ids'
import { encryptSecret } from '../lib/crypto'
import { writeAudit } from '../lib/audit'
import { DB_SELECT, loadDb, serializeDb, type DbRow } from './databases.repo'

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
    `INSERT INTO connections (id, database_id, mode, host, port, username, db_name, ssl, password_enc)
     VALUES (:id, :db, :mode, :host, :port, :username, :dbname, :ssl, :pw)
     ON DUPLICATE KEY UPDATE host=:host, port=:port, username=:username, db_name=:dbname, ssl=:ssl,
       password_enc = ${keepPassword ? 'COALESCE(:pw, password_enc)' : ':pw'}`,
    { id: newId('c'), db: databaseId, mode, host: c.host, port: c.port, username: c.username, dbname: c.database, ssl: c.ssl ? 1 : 0, pw: passwordEnc },
  )
}

export function registerDatabases(router: Router) {
  // List databases, optionally scoped to a project and/or org.
  router.get('/api/databases', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const project = ctx.query.get('project')
    const org = ctx.query.get('org')
    const orgs = await userOrgIds(user.id)
    if (orgs.length === 0) return json([])
    const where: string[] = [`p.org_id IN (${orgs.map(() => '?').join(',')})`]
    const params: unknown[] = [...orgs]
    if (project) { where.push('d.project_id = ?'); params.push(project) }
    if (org) { await assertOrgMember(user.id, org); where.push('p.org_id = ?'); params.push(org) }
    const rows = await query<DbRow>(`${DB_SELECT} WHERE ${where.join(' AND ')} ORDER BY d.created_at`, params)
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
    return json(await serializeDb(await loadDb(user.id, id)))
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
