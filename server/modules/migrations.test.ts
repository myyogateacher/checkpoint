import { describe, expect, mock, test } from 'bun:test'
import {
  GOVERNANCE_ACTIONS,
  emptyStatusCounts,
  registerMigrations,
  assertCanEditMigration,
  assertNotTokenPrincipal,
  canEditMigration,
  canRelease,
  canSelfApprove,
  isGovernanceAction,
} from './migrations'
import { HttpError, Router, type Ctx } from '../lib/http'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, parsePageParams } from '../lib/paging'
import { MULTI_STATEMENT_ERROR } from '../lib/sqlSyntax'
import type { ApiTokenScope, MigrationStatus, SessionUser, UserRole } from '../types'

const user = (role: UserRole, email = `${role}@myt.com`): SessionUser =>
  ({ id: `u_${role}`, email, name: role, picture: null, role })

describe('canRelease — deployment (deploy-gated) migrations', () => {
  test('admin and deployer can release', () => {
    expect(canRelease(true, [], user('admin'))).toBe(true)
    expect(canRelease(true, [], user('deployer'))).toBe(true)
  })

  test('editor and viewer cannot, even when listed as releasers', () => {
    for (const role of ['editor', 'viewer'] as const) {
      expect(canRelease(true, [], user(role))).toBe(false)
      expect(canRelease(true, [`${role}@myt.com`], user(role))).toBe(false)
    }
  })

  test('the ALL_USERS sentinel is not honored', () => {
    expect(canRelease(true, ['*'], user('editor'))).toBe(false)
    expect(canRelease(true, ['*'], user('viewer'))).toBe(false)
  })
})

describe('canRelease — standard migrations (unchanged behavior)', () => {
  test('admin always can', () => {
    expect(canRelease(false, [], user('admin'))).toBe(true)
  })

  test('non-admins only when listed or via ALL_USERS', () => {
    for (const role of ['editor', 'deployer', 'viewer'] as const) {
      expect(canRelease(false, [], user(role))).toBe(false)
      expect(canRelease(false, [`${role}@myt.com`], user(role))).toBe(true)
      expect(canRelease(false, ['*'], user(role))).toBe(true)
    }
  })

  test('listing is by exact email', () => {
    expect(canRelease(false, ['someone-else@myt.com'], user('editor'))).toBe(false)
  })
})

describe('canSelfApprove', () => {
  test('the ALL_USERS sentinel grants anyone', () => {
    expect(canSelfApprove(['*'], 'anyone@myt.com')).toBe(true)
    expect(canSelfApprove(['*', 'dba@myt.com'], 'anyone@myt.com')).toBe(true)
  })

  test('a listed email is granted', () => {
    expect(canSelfApprove(['dba@myt.com'], 'dba@myt.com')).toBe(true)
    expect(canSelfApprove(['lead@myt.com', 'dba@myt.com'], 'dba@myt.com')).toBe(true)
  })

  test('an absent email is denied', () => {
    expect(canSelfApprove(['lead@myt.com'], 'dba@myt.com')).toBe(false)
  })

  test('an empty list denies everyone', () => {
    expect(canSelfApprove([], 'admin@myt.com')).toBe(false)
  })
})

// The product invariant: a token principal (REST or MCP) can never approve,
// reject, apply, schedule or cancel a schedule, whatever its scopes or the
// owner's role. Enforced at the point of action, behind the route allowlist.
describe('assertNotTokenPrincipal', () => {
  const ctx = (apiToken?: Ctx['apiToken']): Ctx =>
    ({
      req: new Request('http://x/api/migrations/m_1/approve', { method: 'POST' }),
      url: new URL('http://x/api/migrations/m_1/approve'),
      params: { id: 'm_1' },
      query: new URLSearchParams(),
      user: user('admin'),
      apiToken,
    })

  const token = (scopes: ApiTokenScope[]): Ctx['apiToken'] => ({ id: 't_1', name: 'ci', scopes })

  test('every governance verb is refused for a token principal', () => {
    for (const action of GOVERNANCE_ACTIONS) {
      expect(() => assertNotTokenPrincipal(ctx(token(['migrations:write'])), action)).toThrow()
    }
  })

  test('refused even for an admin owner holding every scope', () => {
    const all = token(['migrations:read', 'migrations:write', 'catalog:read', 'queries:read', 'audit:read'])
    for (const action of GOVERNANCE_ACTIONS) {
      expect(() => assertNotTokenPrincipal(ctx(all), action)).toThrow()
    }
  })

  // Grammar matters here: this string is what an agent reports back to a human.
  const refusalFor = (action: string): HttpError => {
    try {
      assertNotTokenPrincipal(ctx(token(['migrations:write'])), action)
    } catch (err) {
      return err as HttpError
    }
    throw new Error(`assertNotTokenPrincipal did not throw for "${action}"`)
  }

  test('the refusal is a 403 that points the caller at the UI', () => {
    const err = refusalFor('approve')
    expect(err).toBeInstanceOf(HttpError)
    expect(err.status).toBe(403)
    expect(err.message).toBe(
      'Migrations cannot be approved with an API token or over MCP. ' +
        'Sign in to Checkpoint and act on the migration there.',
    )
  })

  test('every verb renders as correct English', () => {
    expect(refusalFor('reject').message).toBe(
      'Migrations cannot be rejected with an API token or over MCP. ' +
        'Sign in to Checkpoint and act on the migration there.',
    )
    expect(refusalFor('submit').message).toMatch(/^Migrations cannot be submitted with an API token/)
    expect(refusalFor('apply').message).toMatch(/^Migrations cannot be applied with an API token/)
    expect(refusalFor('schedule').message).toMatch(/^Migrations cannot be scheduled with an API token/)
    expect(refusalFor('cancel-schedule').message).toMatch(/^Migration schedules cannot be cancelled with an API token/)
    expect(refusalFor('reviewers').message).toMatch(/^Migration reviewers cannot be changed with an API token/)
  })

  test('no refusal message is malformed by naive verb suffixing', () => {
    for (const action of GOVERNANCE_ACTIONS) {
      // "rejectd", "cancel-scheduled", "reviewersd" and friends.
      expect(refusalFor(action).message).not.toMatch(/\b\w*[^e]d\b(?= with an API token)/)
      expect(refusalFor(action).message).not.toContain('cancel-schedule')
    }
  })

  test('a session principal (no token) passes through', () => {
    for (const action of GOVERNANCE_ACTIONS) {
      expect(() => assertNotTokenPrincipal(ctx(undefined), action)).not.toThrow()
    }
  })

  // Creating a migration (even one that arrives already submitted) and commenting
  // stay open to tokens — they start review rather than short-circuiting it.
  test('non-governance actions are not blocked for tokens (create/comment)', () => {
    for (const action of ['create', 'comment']) {
      expect(() => assertNotTokenPrincipal(ctx(token(['migrations:write'])), action)).not.toThrow()
    }
  })

  test('isGovernanceAction recognizes exactly the governance verbs', () => {
    expect(GOVERNANCE_ACTIONS.every(isGovernanceAction)).toBe(true)
    for (const other of ['create', 'comment', 'comments', 'schedules', '']) {
      expect(isGovernanceAction(other)).toBe(false)
    }
  })

  // Guards the docs claim (docs/mcp.md): layer 3 covers every review-flow verb,
  // so this list must stay in step with the routes under /api/migrations/:id/.
  test('covers every lifecycle, release and reviewer verb', () => {
    for (const verb of ['submit', 'approve', 'reject', 'apply', 'schedule', 'cancel-schedule', 'reviewers']) {
      expect(isGovernanceAction(verb)).toBe(true)
    }
  })
})

// PATCH /api/migrations/:id — draft, pending and approved migrations are editable
// by their author or an editor (editing something in review resets its approval);
// anything settled is not, and the body is validated exactly as create validates it.
describe('assertCanEditMigration', () => {
  const author = user('viewer', 'author@myt.com')
  const mig = (over: Partial<{ status: MigrationStatus; author_email: string; engine: string }> = {}) => ({
    status: 'draft' as MigrationStatus,
    author_email: 'author@myt.com',
    engine: 'mysql',
    ...over,
  })
  const body = (over: Partial<{ title: string; queries: string[] }> = {}) => ({
    title: 'Add an index',
    description: null,
    queries: ['ALTER TABLE users ADD INDEX idx_email (email)'],
    ...over,
  })

  const errorFor = (...args: Parameters<typeof assertCanEditMigration>): HttpError => {
    try {
      assertCanEditMigration(...args)
    } catch (err) {
      return err as HttpError
    }
    throw new Error('assertCanEditMigration did not throw')
  }

  test('a draft passes for its author, and for an editor who is not the author', () => {
    expect(() => assertCanEditMigration(author, mig(), body())).not.toThrow()
    expect(() => assertCanEditMigration(user('editor'), mig(), body())).not.toThrow()
    expect(() => assertCanEditMigration(user('admin'), mig(), body())).not.toThrow()
  })

  test('a migration still in review passes too — editing it resets the approval', () => {
    for (const status of ['pending_approval', 'approved'] as const) {
      expect(() => assertCanEditMigration(author, mig({ status }), body())).not.toThrow()
      expect(() => assertCanEditMigration(user('editor'), mig({ status }), body())).not.toThrow()
    }
  })

  test('a settled or in-flight migration is a 409, whatever the status', () => {
    for (const status of ['rejected', 'running', 'applied', 'failed'] as const) {
      const err = errorFor(user('admin'), mig({ status }), body())
      expect(err.status).toBe(409)
      expect(err.message).toBe('Only draft, pending or approved migrations can be edited')
    }
  })

  test('a non-author without the edit capability is a 403', () => {
    const err = errorFor(user('viewer', 'someone-else@myt.com'), mig(), body())
    expect(err.status).toBe(403)
    expect(err.message).toBe('Your role does not permit this action.')
    // Deployers apply, they do not author or edit.
    expect(errorFor(user('deployer'), mig(), body()).status).toBe(403)
  })

  test('authority is checked before the status rule', () => {
    expect(errorFor(user('viewer', 'nope@myt.com'), mig({ status: 'applied' }), body()).status).toBe(403)
  })

  test('a multi-statement block is rejected, naming the statement', () => {
    const err = errorFor(author, mig(), body({ queries: ['SELECT 1', 'DROP TABLE a; DROP TABLE b;'] }))
    expect(err.status).toBe(400)
    expect(err.message).toBe(`Statement 2: ${MULTI_STATEMENT_ERROR}`)
  })

  test('title and at least one non-empty query are required', () => {
    for (const bad of [body({ title: '   ' }), body({ queries: [] }), body({ queries: ['  ', ''] })]) {
      const err = errorFor(author, mig(), bad)
      expect(err.status).toBe(400)
      expect(err.message).toBe('title and queries are required.')
    }
  })
})

describe('canEditMigration', () => {
  test('the author always qualifies, regardless of role', () => {
    expect(canEditMigration(user('viewer', 'me@myt.com'), 'me@myt.com')).toBe(true)
  })

  test('non-authors need the edit capability', () => {
    expect(canEditMigration(user('editor'), 'other@myt.com')).toBe(true)
    expect(canEditMigration(user('admin'), 'other@myt.com')).toBe(true)
    expect(canEditMigration(user('viewer'), 'other@myt.com')).toBe(false)
    expect(canEditMigration(user('deployer'), 'other@myt.com')).toBe(false)
  })
})

// --- Pagination --------------------------------------------------------------

describe('parsePageParams', () => {
  const parse = (qs: string) => parsePageParams(new URLSearchParams(qs))

  test('no page params at all → null (the route answers with a bare array)', () => {
    expect(parse('')).toBeNull()
    expect(parse('org=o_1&status=draft')).toBeNull()
  })

  test('either param alone is enough, and the other one defaults', () => {
    expect(parse('page=3')).toEqual({ page: 3, pageSize: DEFAULT_PAGE_SIZE })
    expect(parse('page_size=10')).toEqual({ page: 1, pageSize: 10 })
  })

  test('page must be an integer >= 1', () => {
    for (const bad of ['0', '-2', '1.5', 'abc', '']) {
      expect(() => parse(`page=${bad}`)).toThrow('page must be an integer >= 1.')
    }
  })

  test('page_size must be an integer within [1, MAX_PAGE_SIZE]', () => {
    for (const bad of ['0', '-1', '7.5', 'abc', '', String(MAX_PAGE_SIZE + 1), '1000']) {
      const err = (() => {
        try {
          parse(`page_size=${bad}`)
        } catch (e) {
          return e as HttpError
        }
        throw new Error(`page_size=${bad} did not throw`)
      })()
      expect(err.status).toBe(400)
      expect(err.message).toBe(`page_size must be an integer between 1 and ${MAX_PAGE_SIZE}.`)
    }
    expect(parse(`page_size=${MAX_PAGE_SIZE}`)).toEqual({ page: 1, pageSize: MAX_PAGE_SIZE })
  })
})

// The route is exercised against an in-memory stand-in for the pool: every
// listing statement goes through `query`/`queryOne`, so faking those two is
// enough to drive the real SQL-building and envelope code.
const ORG = 'o_1'

type FakeRow = { id: string; status: MigrationStatus; database_id: string; required_approvals?: number }

const FAKE_ROWS: FakeRow[] = [
  ...Array.from({ length: 6 }, (_, i) => ({ id: `m_d${i}`, status: 'draft' as MigrationStatus, database_id: 'db_1' })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: `m_p${i}`, status: 'pending_approval' as MigrationStatus, database_id: 'db_1' })),
  { id: 'm_a0', status: 'applied' as MigrationStatus, database_id: 'db_2' },
]

const migRow = (r: FakeRow) => ({
  ...r,
  db_name: 'shop',
  engine: 'mysql',
  org_id: ORG,
  title: r.id,
  description: null,
  author_email: 'dev@myt.com',
  deploy_gated: 0,
  forked_from_id: null,
  approvers: '[]',
  releasers: '[]',
  self_approvers: '[]',
  required_approvals: r.required_approvals ?? 1,
  created_at: new Date('2026-01-01T00:00:00Z'),
  approved_by: null,
  approved_at: null,
  applied_at: null,
  scheduled_for: null,
  scheduled_by: null,
})

// Re-derive the filters the module put into the statement, in the order
// `migrationScope` appends them after the org-scope placeholders.
function filtersOf(sql: string, params: unknown[]) {
  let i = 1 // one org in the membership list
  const out: { database?: string; status?: string } = {}
  if (sql.includes('m.database_id = ?')) out.database = params[i++] as string
  if (sql.includes('p.org_id = ?')) i++
  if (sql.includes('m.status = ?')) out.status = params[i++] as string
  return out
}

function matching(sql: string, params: unknown[]): FakeRow[] {
  const f = filtersOf(sql, params)
  return FAKE_ROWS.filter((r) => (!f.database || r.database_id === f.database) && (!f.status || r.status === f.status))
}

// Migrations addressed by id (the lifecycle routes), kept out of FAKE_ROWS so the
// pagination expectations above stay untouched, plus their event log.
const BY_ID = new Map<string, FakeRow>()
type FakeEvent = { migration_id: string; at: string; action: string; actor_email: string }
let EVENTS: FakeEvent[] = []

// Statements the handler issued, so a test can assert on the status flip.
const EXECUTED: string[] = []

const lastEditAt = (id: string) =>
  EVENTS.filter((e) => e.migration_id === id && e.action === 'edited')
    .map((e) => e.at)
    .sort()
    .at(-1) ?? ''

// Stand-in for the approval counts, applying the since-last-edit window only when
// the statement actually carries the predicate — so a query that forgot it counts
// every approval and the test fails.
function approvalCount(sql: string, params: Record<string, unknown>) {
  const id = String(params.id)
  let rows = EVENTS.filter((e) => e.migration_id === id && e.action === 'approve')
  if (sql.includes("action = 'edited'")) rows = rows.filter((e) => e.at > lastEditAt(id))
  if (sql.includes('COUNT(DISTINCT actor_email)')) {
    return [{ approvals: new Set(rows.map((e) => e.actor_email)).size }]
  }
  return [{ mine: rows.filter((e) => e.actor_email === params.email).length }]
}

mock.module('../db/pool', () => ({
  pool: {},
  execute: async (sql: string) => {
    EXECUTED.push(sql)
    return {}
  },
  transaction: async () => undefined,
  queryOne: async (sql: string, params: unknown[] | Record<string, unknown> = []) => {
    if (sql.includes('COUNT(*)')) return { n: matching(sql, params as unknown[]).length }
    // loadMig
    if (sql.includes('FROM migrations m')) {
      const row = BY_ID.get(String((params as Record<string, unknown>).id))
      return row ? migRow(row) : undefined
    }
    return undefined
  },
  query: async (sql: string, params: unknown[] | Record<string, unknown> = []) => {
    if (sql.includes('FROM memberships')) return [{ org_id: ORG }]
    if (sql.includes('FROM migration_events') && sql.includes('COUNT(')) {
      return approvalCount(sql, params as Record<string, unknown>)
    }
    if (sql.includes('GROUP BY m.status')) {
      const counts = new Map<string, number>()
      for (const r of matching(sql, params as unknown[])) counts.set(r.status, (counts.get(r.status) ?? 0) + 1)
      return [...counts].map(([status, n]) => ({ status, n }))
    }
    // fullMigration's per-migration lookups (queries, reviewers, comments, events).
    if (sql.includes('FROM migration_')) return []
    const rows = matching(sql, params as unknown[]).map(migRow)
    const limit = /LIMIT (\d+) OFFSET (\d+)/.exec(sql)
    return limit ? rows.slice(Number(limit[2]), Number(limit[2]) + Number(limit[1])) : rows
  },
}))

describe('GET /api/migrations — pagination envelope', () => {
  const router = new Router()
  registerMigrations(router)

  async function get(qs: string) {
    const url = new URL(`http://x/api/migrations${qs}`)
    const match = router.match('GET', url.pathname)!
    return match.handler({
      req: new Request(url.toString()),
      url,
      params: {},
      query: url.searchParams,
      user: user('admin'),
    })
  }

  interface Envelope {
    items: Array<{ id: string; status: MigrationStatus; database_name: string }>
    total: number
    page: number
    page_size: number
    counts: Record<string, number>
  }
  const body = async <T>(qs: string): Promise<T> => (await get(qs)).json() as Promise<T>

  test('without page params the response is still the bare array', async () => {
    const payload = await body<unknown[]>('')
    expect(Array.isArray(payload)).toBe(true)
    expect(payload).toHaveLength(FAKE_ROWS.length)
  })

  test('with page params the response is the envelope', async () => {
    const payload = await body<Envelope>('?page=1&page_size=4')
    expect(Array.isArray(payload)).toBe(false)
    expect(Object.keys(payload).sort()).toEqual(['counts', 'items', 'page', 'page_size', 'total'])
    expect(payload.page).toBe(1)
    expect(payload.page_size).toBe(4)
    expect(payload.total).toBe(FAKE_ROWS.length)
    expect(payload.items).toHaveLength(4)
    // Items are full migration objects, as the unpaginated route returns.
    expect(payload.items[0]).toMatchObject({ id: 'm_d0', database_name: 'shop', queries: [], events: [] })
  })

  test('page_size alone paginates from page 1', async () => {
    const payload = await body<Envelope>('?page_size=2')
    expect(payload.page).toBe(1)
    expect(payload.items.map((m) => m.id)).toEqual(['m_d0', 'm_d1'])
  })

  test('offset walks the list and the last page may be short', async () => {
    const second = await body<Envelope>('?page=2&page_size=4')
    expect(second.items.map((m: { id: string }) => m.id)).toEqual(['m_d4', 'm_d5', 'm_p0', 'm_p1'])
    const last = await body<Envelope>('?page=3&page_size=4')
    expect(last.items).toHaveLength(3)
  })

  test('a page past the end is empty but still reports the real total', async () => {
    const payload = await body<Envelope>('?page=99&page_size=10')
    expect(payload.items).toEqual([])
    expect(payload.total).toBe(FAKE_ROWS.length)
  })

  test('total respects the status filter; counts do not', async () => {
    const payload = await body<Envelope>('?page=1&page_size=25&status=draft')
    expect(payload.total).toBe(6)
    expect(payload.items.every((m) => m.status === 'draft')).toBe(true)
    expect(payload.counts).toEqual({ ...emptyStatusCounts(), draft: 6, pending_approval: 4, applied: 1 })
    // 'all' in the UI is the sum of the per-status counts.
    expect(Object.values(payload.counts).reduce((a, b) => a + b, 0)).toBe(FAKE_ROWS.length)
  })

  test('counts carry every status, zeros included', async () => {
    const payload = await body<Envelope>('?page=1')
    expect(Object.keys(payload.counts).sort()).toEqual(Object.keys(emptyStatusCounts()).sort())
    expect(payload.counts.failed).toBe(0)
  })

  test('the database filter still applies alongside paging', async () => {
    const payload = await body<Envelope>('?page=1&page_size=10&database=db_2')
    expect(payload.total).toBe(1)
    expect(payload.items).toHaveLength(1)
  })

  test('an invalid page_size is a 400 and never reaches the database', async () => {
    const res = await get('?page=1&page_size=500').catch((e: HttpError) => e)
    expect(res).toBeInstanceOf(HttpError)
    expect((res as HttpError).status).toBe(400)
  })
})

// Editing a migration resets its approval, so approvals recorded before the last
// 'edited' event must not count toward the threshold (server/modules/migrations.ts).
describe('POST /api/migrations/:id/approve — approvals are windowed to the last edit', () => {
  const router = new Router()
  registerMigrations(router)
  const MIG = 'm_rev'
  const approvedFlip = () => EXECUTED.some((sql) => sql.includes('approved_by = :by'))

  async function approve(as = user('admin')) {
    const url = new URL(`http://x/api/migrations/${MIG}/approve`)
    const match = router.match('POST', url.pathname)!
    return match.handler({
      req: new Request(url.toString(), { method: 'POST' }),
      url,
      params: { id: MIG },
      query: url.searchParams,
      user: as,
    } as unknown as Ctx)
  }

  // Two approvals required, so one surviving pre-edit approval would be visible.
  function setup(events: FakeEvent[]) {
    BY_ID.set(MIG, { id: MIG, status: 'pending_approval', database_id: 'db_1', required_approvals: 2 })
    EVENTS = events
    EXECUTED.length = 0
  }
  const ev = (at: string, action: string, actor_email = 'a@myt.com'): FakeEvent =>
    ({ migration_id: MIG, at, action, actor_email })

  test('approvals recorded before the last edit do not count', async () => {
    setup([ev('2026-01-01T10:00:00Z', 'approve'), ev('2026-01-01T11:00:00Z', 'edited', 'dev@myt.com')])
    await approve()
    // Only this approval counts (1 of 2), so the migration stays pending.
    expect(approvedFlip()).toBe(false)
  })

  test('approvals recorded after the last edit still count', async () => {
    setup([ev('2026-01-01T11:00:00Z', 'edited', 'dev@myt.com'), ev('2026-01-01T12:00:00Z', 'approve')])
    await approve()
    expect(approvedFlip()).toBe(true)
  })

  test('a pre-edit approval does not block the same approver from approving again', async () => {
    setup([ev('2026-01-01T10:00:00Z', 'approve', 'admin@myt.com'), ev('2026-01-01T11:00:00Z', 'edited', 'dev@myt.com')])
    expect(await approve().then(() => null).catch((e: HttpError) => e)).toBeNull()
  })

  test('an approval after the last edit is still one vote per person', async () => {
    setup([ev('2026-01-01T11:00:00Z', 'edited', 'dev@myt.com'), ev('2026-01-01T12:00:00Z', 'approve', 'admin@myt.com')])
    const err = await approve().then(() => null).catch((e: HttpError) => e)
    expect(err?.status).toBe(400)
    expect(err?.message).toBe('You have already approved this migration.')
  })
})
