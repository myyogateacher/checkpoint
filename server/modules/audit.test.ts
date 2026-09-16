import { describe, expect, mock, test } from 'bun:test'
import { CATEGORY_SQL, isAuditCategory, registerAudit } from './audit'
import { HttpError, Router } from '../lib/http'
import { likeTerm } from '../lib/paging'
import type { SessionUser } from '../types'

const admin: SessionUser = { id: 'u_1', email: 'admin@myt.com', name: 'Admin', picture: null, role: 'admin' }
const ORG = 'o_1'

interface FakeRow {
  id: string
  action: string
  summary: string
  actor_email: string
  entity_label: string
}

// One row per category, plus two rows whose text contains LIKE metacharacters.
const ROWS: FakeRow[] = [
  { id: 'a1', action: 'migration.apply', summary: 'Apply migration on shop', actor_email: 'dev@myt.com', entity_label: 'Add index' },
  { id: 'a2', action: 'migration.approve', summary: 'Approve migration', actor_email: 'dev@myt.com', entity_label: 'Add index' },
  { id: 'a3', action: 'schema.sync', summary: 'Sync schema', actor_email: 'ops@myt.com', entity_label: 'shop' },
  { id: 'a4', action: 'query.read', summary: 'Ran a read query', actor_email: 'ops@myt.com', entity_label: 'shop' },
  { id: 'a5', action: 'user.invite', summary: 'Invite user', actor_email: 'admin@myt.com', entity_label: 'new@myt.com' },
  { id: 'a6', action: 'connection.update', summary: 'Update connection', actor_email: 'admin@myt.com', entity_label: 'shop-rw' },
  { id: 'a7', action: 'project.update', summary: 'Discount set to 50% off', actor_email: 'admin@myt.com', entity_label: 'pricing' },
  { id: 'a8', action: 'project.update', summary: 'Discount set to 50 percent off', actor_email: 'admin@myt.com', entity_label: 'pricing' },
]

const categoryOf = (action: string) =>
  action.startsWith('migration.') ? 'migration' : action.startsWith('schema.') || action.startsWith('query.') ? 'manual' : 'system'

// Apply the WHERE the module built, by reading it back off the statement: which
// category branch it used, and the term it bound. Only the WHERE is inspected —
// the counts statement names every category clause in its SELECT list.
function matching(sql: string, params: unknown[]): FakeRow[] {
  const where = sql.split(/\bWHERE\b/)[1] ?? ''
  let rows = ROWS
  // `system` is tested first: its clause contains the other two verbatim.
  const category = (['system', 'migration', 'manual'] as const).find((c) => where.includes(CATEGORY_SQL[c]))
  if (category) rows = rows.filter((r) => categoryOf(r.action) === category)
  if (where.includes('LIKE ? ESCAPE')) {
    // The bound value is `%term%` with LIKE metacharacters backslash-escaped;
    // undo that to get the literal string the user typed.
    const term = String(params[params.length - 1]).slice(1, -1).replace(/\\(.)/g, '$1').toLowerCase()
    rows = rows.filter((r) =>
      [r.summary, r.actor_email, r.entity_label, r.action].some((f) => f.toLowerCase().includes(term)),
    )
  }
  return rows
}

mock.module('../db/pool', () => ({
  pool: {},
  execute: async () => ({}),
  transaction: async () => undefined,
  query: async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM memberships')) return [{ org_id: ORG }]
    const rows = matching(sql, params).map((r) => ({
      ...r,
      actor_name: null,
      entity_type: 'migration',
      entity_id: null,
      created_at: new Date('2026-01-01T00:00:00Z'),
    }))
    const limit = /LIMIT (\d+) OFFSET (\d+)/.exec(sql)
    return limit ? rows.slice(Number(limit[2]), Number(limit[2]) + Number(limit[1])) : rows
  },
  queryOne: async (sql: string, params: unknown[] = []) => {
    const rows = matching(sql, params)
    if (sql.includes('all_n')) {
      return {
        all_n: rows.length,
        migration_n: rows.filter((r) => categoryOf(r.action) === 'migration').length,
        manual_n: rows.filter((r) => categoryOf(r.action) === 'manual').length,
        system_n: rows.filter((r) => categoryOf(r.action) === 'system').length,
      }
    }
    return { n: rows.length }
  },
}))

describe('GET /api/audit-logs — pagination envelope', () => {
  const router = new Router()
  registerAudit(router)

  interface Envelope {
    items: Array<{ id: string; action: string }>
    total: number
    page: number
    page_size: number
    counts: { all: number; system: number; migration: number; manual: number }
  }

  async function get(qs: string) {
    const url = new URL(`http://x/api/audit-logs${qs}`)
    const match = router.match('GET', url.pathname)!
    return match.handler({ req: new Request(url.toString()), url, params: {}, query: url.searchParams, user: admin })
  }
  const body = async <T,>(qs: string): Promise<T> => (await get(qs)).json() as Promise<T>
  const ids = (e: Envelope) => e.items.map((i) => i.id)

  test('without page params the response is still the bare array', async () => {
    const payload = await body<unknown[]>('')
    expect(Array.isArray(payload)).toBe(true)
    expect(payload).toHaveLength(ROWS.length)
  })

  test('with page params the response is the envelope', async () => {
    const payload = await body<Envelope>('?page=1&page_size=3')
    expect(Object.keys(payload).sort()).toEqual(['counts', 'items', 'page', 'page_size', 'total'])
    expect(payload).toMatchObject({ page: 1, page_size: 3, total: ROWS.length })
    expect(ids(payload)).toEqual(['a1', 'a2', 'a3'])
    expect(payload.counts).toEqual({ all: 8, migration: 2, manual: 2, system: 4 })
  })

  test('the second page continues where the first stopped', async () => {
    expect(ids(await body<Envelope>('?page=2&page_size=3'))).toEqual(['a4', 'a5', 'a6'])
    expect((await body<Envelope>('?page=4&page_size=3')).items).toEqual([])
  })

  test('the migration and manual categories match auditCategory()', async () => {
    const migrations = await body<Envelope>('?page=1&category=migration')
    expect(migrations.total).toBe(2)
    expect(migrations.items.every((i) => i.action.startsWith('migration.'))).toBe(true)

    const manual = await body<Envelope>('?page=1&category=manual')
    expect(manual.items.map((i) => i.action)).toEqual(['schema.sync', 'query.read'])
  })

  test('system excludes every migration./schema./query. action', async () => {
    const payload = await body<Envelope>('?page=1&category=system')
    expect(payload.total).toBe(4)
    expect(
      payload.items.every(
        (i) => !/^(migration|schema|query)\./.test(i.action),
      ),
    ).toBe(true)
    // Filtering by category does not change the pill counts.
    expect(payload.counts).toEqual({ all: 8, migration: 2, manual: 2, system: 4 })
  })

  test('an unknown category is ignored rather than erroring', async () => {
    expect((await body<Envelope>('?page=1&category=nonsense')).total).toBe(ROWS.length)
  })

  test('the search term filters across summary, actor, entity and action', async () => {
    expect(ids(await body<Envelope>('?page=1&q=ops@myt.com'))).toEqual(['a3', 'a4'])
    expect(ids(await body<Envelope>('?page=1&q=Add%20index'))).toEqual(['a1', 'a2'])
    expect(ids(await body<Envelope>('?page=1&q=connection.update'))).toEqual(['a6'])
  })

  test('a % in the search term is literal, not a wildcard', async () => {
    const payload = await body<Envelope>('?page=1&q=50%25')
    expect(ids(payload)).toEqual(['a7'])
    // …and the counts follow the search term, not the whole log.
    expect(payload.counts.all).toBe(1)
    expect(likeTerm('50%')).toBe('%50\\%%')
    expect(likeTerm('a_b\\c')).toBe('%a\\_b\\\\c%')
  })

  test('an invalid page_size is a 400', async () => {
    const err = await get('?page_size=0').catch((e: HttpError) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect((err as HttpError).status).toBe(400)
  })

  test('isAuditCategory accepts exactly the three categories', () => {
    expect(['system', 'migration', 'manual'].every(isAuditCategory)).toBe(true)
    for (const other of ['all', '', null, undefined, 'Migration']) expect(isAuditCategory(other)).toBe(false)
  })
})
