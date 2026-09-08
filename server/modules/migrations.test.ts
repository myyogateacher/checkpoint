import { describe, expect, test } from 'bun:test'
import {
  GOVERNANCE_ACTIONS,
  assertCanEditDraft,
  assertNotTokenPrincipal,
  canEditMigration,
  canRelease,
  canSelfApprove,
  isGovernanceAction,
} from './migrations'
import { HttpError, type Ctx } from '../lib/http'
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

// PATCH /api/migrations/:id — drafts are editable by their author or an editor;
// anything already in review is not, and the body is validated exactly as create
// validates it.
describe('assertCanEditDraft', () => {
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

  const errorFor = (...args: Parameters<typeof assertCanEditDraft>): HttpError => {
    try {
      assertCanEditDraft(...args)
    } catch (err) {
      return err as HttpError
    }
    throw new Error('assertCanEditDraft did not throw')
  }

  test('a draft passes for its author, and for an editor who is not the author', () => {
    expect(() => assertCanEditDraft(author, mig(), body())).not.toThrow()
    expect(() => assertCanEditDraft(user('editor'), mig(), body())).not.toThrow()
    expect(() => assertCanEditDraft(user('admin'), mig(), body())).not.toThrow()
  })

  test('a non-draft is a 409, whatever the status', () => {
    for (const status of ['pending_approval', 'approved', 'rejected', 'running', 'applied', 'failed'] as const) {
      const err = errorFor(user('admin'), mig({ status }), body())
      expect(err.status).toBe(409)
      expect(err.message).toBe('Only draft migrations can be edited')
    }
  })

  test('a non-author without the edit capability is a 403', () => {
    const err = errorFor(user('viewer', 'someone-else@myt.com'), mig(), body())
    expect(err.status).toBe(403)
    expect(err.message).toBe('Your role does not permit this action.')
    // Deployers apply, they do not author or edit.
    expect(errorFor(user('deployer'), mig(), body()).status).toBe(403)
  })

  test('authority is checked before the draft rule', () => {
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
