import { describe, expect, mock, test } from 'bun:test'
import { Parser } from 'node-sql-parser'
import { CATEGORY_SQL, isAuditCategory, registerAudit } from './audit'
import { HttpError, Router } from '../lib/http'
import { likeTerm } from '../lib/paging'
import type { SessionUser } from '../types'

const admin: SessionUser = { id: 'u_1', email: 'admin@myt.com', name: 'Admin', picture: null, role: 'admin' }
const ORG = 'o_1'

// audit_logs has no database_id, so the module joins its way to one: a `database`
// row names it outright, a `migration` row is one hop away through migrations, and
// every other entity type has none. These two maps stand in for that hop, and are
// what makes "which rows does a database/environment filter reach" testable at all.
const MIGRATION_DB: Record<string, string> = { m1: 'db_shop', m2: 'db_ledger' }
const DB_ENV: Record<string, string> = { db_shop: 'production', db_ledger: 'staging' }

interface FakeRow {
  id: string
  action: string
  summary: string
  actor_email: string
  entity_label: string
  entity_type: string
  entity_id: string | null
  created_at: Date
}

// One row per category, two rows whose text contains LIKE metacharacters, and a
// spread of entity types / actors / days so each filter has something to exclude.
// Listed newest first, which is the order the real ORDER BY created_at DESC gives.
const ROWS: FakeRow[] = [
  { id: 'a1', action: 'migration.apply', summary: 'Apply migration on shop', actor_email: 'dev@myt.com', entity_label: 'Add index', entity_type: 'migration', entity_id: 'm1', created_at: new Date('2026-01-03T10:00:00Z') },
  { id: 'a2', action: 'migration.approve', summary: 'Approve migration', actor_email: 'dev@myt.com', entity_label: 'Add index', entity_type: 'migration', entity_id: 'm2', created_at: new Date('2026-01-03T09:00:00Z') },
  { id: 'a3', action: 'schema.sync', summary: 'Sync schema', actor_email: 'ops@myt.com', entity_label: 'shop', entity_type: 'database', entity_id: 'db_shop', created_at: new Date('2026-01-02T10:00:00Z') },
  { id: 'a4', action: 'query.read', summary: 'Ran a read query', actor_email: 'ops@myt.com', entity_label: 'shop', entity_type: 'database', entity_id: 'db_ledger', created_at: new Date('2026-01-02T09:00:00Z') },
  { id: 'a5', action: 'user.invite', summary: 'Invite user', actor_email: 'admin@myt.com', entity_label: 'new@myt.com', entity_type: 'user', entity_id: 'u_9', created_at: new Date('2026-01-01T12:00:00Z') },
  { id: 'a6', action: 'connection.update', summary: 'Update connection', actor_email: 'admin@myt.com', entity_label: 'shop-rw', entity_type: 'database', entity_id: 'db_shop', created_at: new Date('2026-01-01T11:00:00Z') },
  { id: 'a7', action: 'project.update', summary: 'Discount set to 50% off', actor_email: 'admin@myt.com', entity_label: 'pricing', entity_type: 'project', entity_id: 'p_1', created_at: new Date('2026-01-01T10:00:00Z') },
  { id: 'a8', action: 'project.update', summary: 'Discount set to 50 percent off', actor_email: 'admin@myt.com', entity_label: 'pricing', entity_type: 'project', entity_id: 'p_1', created_at: new Date('2026-01-01T09:00:00Z') },
]

const categoryOf = (action: string) =>
  action.startsWith('migration.') ? 'migration' : action.startsWith('schema.') || action.startsWith('query.') ? 'manual' : 'system'

// The LEFT JOIN's result for one row: null is what a project/user/api_token row
// gets, and null never equals a bound id, so those rows drop out of both filters.
const databaseOf = (r: FakeRow): string | null =>
  r.entity_type === 'database'
    ? r.entity_id
    : r.entity_type === 'migration'
      ? MIGRATION_DB[r.entity_id ?? ''] ?? null
      : null

// Every statement the module issued, so a test can assert on the SQL itself
// (which joins it added, whether it parses) rather than only on the rows back.
const ISSUED: string[] = []

// Apply the WHERE the module built, clause by clause, consuming `params` in the
// order each `?` appears. That ordering is the contract under test: a predicate
// pushed out of step with its value binds the wrong column and would still return
// plausible rows. An unrecognized clause throws rather than being skipped, so a
// filter cannot pass this suite by being silently ignored.
function matching(sql: string, params: unknown[]): FakeRow[] {
  const where = (sql.split(/\bWHERE\b/)[1] ?? '').split(/\bORDER BY\b/)[0]
  let rows = ROWS
  let cursor = 0
  for (const raw of where.split(' AND ')) {
    const clause = raw.trim()
    const args = params.slice(cursor, (cursor += (clause.match(/\?/g) ?? []).length))
    const category = (['system', 'migration', 'manual'] as const).find((c) => CATEGORY_SQL[c] === clause)
    // listAuditEvents() selects without the `a` alias; both spellings are the org scope.
    if (/^(a\.)?org_id IN/.test(clause)) continue
    else if (category) rows = rows.filter((r) => categoryOf(r.action) === category)
    else if (clause === 'a.actor_email = ?') rows = rows.filter((r) => r.actor_email === args[0])
    else if (clause === 'd.id = ?') rows = rows.filter((r) => databaseOf(r) === args[0])
    else if (clause === 'e.name = ?') rows = rows.filter((r) => DB_ENV[databaseOf(r) ?? ''] === args[0])
    else if (clause === 'a.created_at >= ?') rows = rows.filter((r) => r.created_at >= (args[0] as Date))
    else if (clause === 'a.created_at < ?') rows = rows.filter((r) => r.created_at < (args[0] as Date))
    else if (clause.includes('LIKE ? ESCAPE')) {
      // The bound value is `%term%` with LIKE metacharacters backslash-escaped;
      // undo that to get the literal string the user typed.
      const term = String(args[0]).slice(1, -1).replace(/\\(.)/g, '$1').toLowerCase()
      rows = rows.filter((r) =>
        [r.summary, r.actor_email, r.entity_label, r.action].some((f) => f.toLowerCase().includes(term)),
      )
    } else throw new Error(`matching(): unhandled WHERE clause ${JSON.stringify(clause)}`)
  }
  return rows
}

mock.module('../db/pool', () => ({
  pool: {},
  execute: async () => ({}),
  transaction: async () => undefined,
  query: async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM memberships')) return [{ org_id: ORG }]
    ISSUED.push(sql)
    const rows = matching(sql, params).map((r) => ({ ...r, actor_name: null }))
    const limit = /LIMIT (\d+) OFFSET (\d+)/.exec(sql)
    return limit ? rows.slice(Number(limit[2]), Number(limit[2]) + Number(limit[1])) : rows
  },
  queryOne: async (sql: string, params: unknown[] = []) => {
    ISSUED.push(sql)
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

  // The statements one request issued, so a test reads only its own SQL.
  async function sqlFor(qs: string): Promise<string[]> {
    ISSUED.length = 0
    await body<Envelope>(qs)
    return [...ISSUED]
  }

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

  test('the actor filter is an exact match on the stored email, and the pills follow it', async () => {
    const payload = await body<Envelope>('?page=1&actor=ops@myt.com')
    expect(ids(payload)).toEqual(['a3', 'a4'])
    // The pills would lie about the page they sit above if they ignored the filter.
    expect(payload.counts).toEqual({ all: 2, migration: 0, manual: 2, system: 0 })
    // A substring of a real actor is not a match — this filter is not the search box.
    expect((await body<Envelope>('?page=1&actor=ops')).total).toBe(0)
  })

  test('the database filter reaches a migration row through its migration', async () => {
    // a1 is a migration on db_shop; a3/a6 name db_shop directly.
    expect(ids(await body<Envelope>('?page=1&database=db_shop'))).toEqual(['a1', 'a3', 'a6'])
    expect(ids(await body<Envelope>('?page=1&database=db_ledger'))).toEqual(['a2', 'a4'])
  })

  test('the environment filter matches the environment name, not one project row', async () => {
    expect(ids(await body<Envelope>('?page=1&environment=production'))).toEqual(['a1', 'a3', 'a6'])
    expect(ids(await body<Envelope>('?page=1&environment=staging'))).toEqual(['a2', 'a4'])
  })

  test('a row with no database is excluded by the database and environment filters', async () => {
    // a5 (user), a7/a8 (project) have no database to join to. Every value of either
    // filter must leave them out rather than letting NULL through as a match.
    for (const qs of ['?page=1&database=db_shop', '?page=1&database=db_ledger', '?page=1&environment=production', '?page=1&environment=staging']) {
      const got = ids(await body<Envelope>(qs))
      expect(got).not.toContain('a5')
      expect(got).not.toContain('a7')
      expect(got).not.toContain('a8')
    }
  })

  test('the database and environment filters combine instead of overriding', async () => {
    expect(ids(await body<Envelope>('?page=1&database=db_shop&environment=production'))).toEqual(['a1', 'a3', 'a6'])
    // db_shop is in production, so pairing it with staging is empty, not "staging".
    expect((await body<Envelope>('?page=1&database=db_shop&environment=staging')).total).toBe(0)
  })

  test('from is inclusive of its instant and to is exclusive of its own', async () => {
    // a1 sits exactly on 2026-01-03T10:00:00Z. Inclusive/exclusive is the whole
    // point of the pair: the client sends the start of the day AFTER the one the
    // user picked as `to`, so an off-by-one here silently drops the last day.
    expect(ids(await body<Envelope>('?page=1&from=2026-01-03T10:00:00.000Z'))).toEqual(['a1'])
    expect(ids(await body<Envelope>('?page=1&to=2026-01-03T10:00:00.000Z'))).toEqual(['a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'])
    // A single calendar day, bounded the way the page bounds it.
    expect(ids(await body<Envelope>('?page=1&from=2026-01-02T00:00:00.000Z&to=2026-01-03T00:00:00.000Z'))).toEqual(['a3', 'a4'])
  })

  test('an unparseable date bound is a 400, not an unfiltered page', async () => {
    for (const qs of ['?page=1&from=yesterday', '?page=1&to=2026-13-45']) {
      const err = await get(qs).catch((e: HttpError) => e)
      expect(err).toBeInstanceOf(HttpError)
      expect((err as HttpError).status).toBe(400)
    }
  })

  test('the database join is added only when a database or environment filter is set', async () => {
    // audit_logs only grows, so the common request has to keep its single-table
    // plan on the (org_id, created_at) index.
    for (const sql of await sqlFor('?page=1&actor=ops@myt.com&from=2026-01-01T00:00:00.000Z')) {
      expect(sql).not.toContain('LEFT JOIN')
    }
    for (const sql of await sqlFor('?page=1&database=db_shop')) {
      expect(sql).toContain('LEFT JOIN migrations m')
      expect(sql).toContain('LEFT JOIN `databases` d')
      expect(sql).not.toContain('LEFT JOIN environments')
    }
    for (const sql of await sqlFor('?page=1&environment=production&database=db_shop')) {
      // One join chain even with both filters set, or COUNT(*) would double-count.
      expect(sql.match(/LEFT JOIN migrations m/g)).toHaveLength(1)
      expect(sql).toContain('LEFT JOIN environments e')
    }
  })

  test('every statement the filters build is valid MySQL', async () => {
    // Syntax only — no engine runs these here, and a parser cannot tell whether a
    // column exists. It does catch the class that has shipped before: SQL that was
    // asserted as a string in a test and first executed in production.
    const parser = new Parser()
    const statements = [
      ...(await sqlFor('?page=1')),
      ...(await sqlFor('?page=1&category=system&q=50%25')),
      ...(await sqlFor('?page=1&actor=ops@myt.com&database=db_shop&environment=production&from=2026-01-01T00:00:00.000Z&to=2026-01-04T00:00:00.000Z&page_size=10')),
    ]
    expect(statements.length).toBeGreaterThan(0)
    for (const sql of statements) {
      expect(() => parser.astify(sql, { database: 'MySQL' })).not.toThrow()
    }
  })
})
