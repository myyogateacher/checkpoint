import { type Router, type Ctx, json, readJson, badRequest, notFound } from '../lib/http'
import { query, queryOne, execute } from '../db/pool'
import { requireUser, userOrgIds, assertOrgMember } from '../lib/auth'
import { newId } from '../lib/ids'
import { asJson, bool, iso } from '../lib/serialize'

interface SqRow {
  id: string
  org_id: string
  database_id: string
  db_name: string
  engine: string
  name: string
  description: string | null
  tags: unknown
  sql_text: string
  shared: number
  author_email: string
  created_at: Date
}

const SQ_SELECT = `
  SELECT sq.*, d.name AS db_name, d.engine
  FROM saved_queries sq JOIN \`databases\` d ON d.id = sq.database_id`

const toSq = (r: SqRow) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  tags: asJson<string[]>(r.tags, []),
  database_id: r.database_id,
  database_name: r.db_name,
  engine: r.engine,
  sql: r.sql_text,
  shared: bool(r.shared),
  author_email: r.author_email,
  created_at: iso(r.created_at)!,
})

export function registerSavedQueries(router: Router) {
  router.get('/api/saved-queries', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const orgs = await userOrgIds(user.id)
    if (orgs.length === 0) return json([])
    const rows = await query<SqRow>(`${SQ_SELECT} WHERE sq.org_id IN (${orgs.map(() => '?').join(',')}) ORDER BY sq.created_at DESC`, orgs)
    return json(rows.map(toSq))
  })

  router.get('/api/saved-queries/:id', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const row = await queryOne<SqRow>(`${SQ_SELECT} WHERE sq.id = :id`, { id: ctx.params.id })
    if (!row) throw notFound('Saved query not found')
    await assertOrgMember(user.id, row.org_id)
    return json(toSq(row))
  })

  router.post('/api/saved-queries', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const body = await readJson<{ database_id: string; name: string; description: string | null; tags: string[]; sql: string; shared: boolean }>(ctx.req)
    if (!body.database_id || !body.name?.trim()) throw badRequest('database_id and name are required.')
    const db = await queryOne<{ org_id: string }>('SELECT p.org_id FROM `databases` d JOIN projects p ON p.id = d.project_id WHERE d.id = :id', { id: body.database_id })
    if (!db) throw badRequest('Unknown database.')
    await assertOrgMember(user.id, db.org_id)
    const id = newId('sq')
    await execute(
      `INSERT INTO saved_queries (id, org_id, database_id, name, description, tags, sql_text, shared, author_email)
       VALUES (:id, :org, :db, :name, :desc, :tags, :sql, :shared, :author)`,
      { id, org: db.org_id, db: body.database_id, name: body.name.trim(), desc: body.description ?? null, tags: JSON.stringify(body.tags ?? []), sql: body.sql, shared: body.shared ? 1 : 0, author: user.email },
    )
    const row = await queryOne<SqRow>(`${SQ_SELECT} WHERE sq.id = :id`, { id })
    return json(toSq(row!))
  })
}
