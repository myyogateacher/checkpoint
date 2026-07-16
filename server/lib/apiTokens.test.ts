import { describe, expect, test } from 'bun:test'
import {
  API_TOKEN_SCOPES,
  TOKEN_ROUTES,
  generateApiToken,
  hashApiToken,
  isValidScopeList,
  parseCreateTokenInput,
  rateLimitAllows,
  readBearerToken,
  recordRateLimitFailure,
  tokenValidity,
  type RateWindow,
} from './apiTokens'

describe('generateApiToken', () => {
  test('produces a chk_-prefixed secret with matching hash and display prefix', () => {
    const { token, hash, prefix } = generateApiToken()
    expect(token.startsWith('chk_')).toBe(true)
    expect(token.length).toBeGreaterThanOrEqual(40)
    expect(hash).toBe(hashApiToken(token))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(prefix).toBe(token.slice(0, 12))
  })

  test('every token is unique', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateApiToken().token))
    expect(tokens.size).toBe(100)
  })
})

describe('readBearerToken', () => {
  const req = (auth?: string) =>
    new Request('http://x/api/migrations', { headers: auth ? { authorization: auth } : {} })

  test('null without a header or with a non-Bearer scheme (falls through to session)', () => {
    expect(readBearerToken(req())).toBeNull()
    expect(readBearerToken(req('Basic dXNlcjpwYXNz'))).toBeNull()
  })

  test('extracts a chk_ token, scheme case-insensitively', () => {
    expect(readBearerToken(req('Bearer chk_abc'))).toBe('chk_abc')
    expect(readBearerToken(req('bearer chk_abc'))).toBe('chk_abc')
  })

  test('foreign bearers (proxy JWTs) and bare "Bearer" fall through to session auth', () => {
    expect(readBearerToken(req('Bearer eyJhbGciOiJIUzI1NiJ9.e30.x'))).toBeNull()
    expect(readBearerToken(req('Bearer'))).toBeNull()
  })
})

describe('tokenValidity', () => {
  const now = new Date('2026-07-16T12:00:00Z')
  const base = { expires_at: null, revoked_at: null, user_banned: false }

  test('ok when unexpired, unrevoked, owner active', () => {
    expect(tokenValidity(base, now)).toBe('ok')
    expect(tokenValidity({ ...base, expires_at: new Date('2026-08-01') }, now)).toBe('ok')
  })

  test('expired at or after expires_at', () => {
    expect(tokenValidity({ ...base, expires_at: now }, now)).toBe('expired')
    expect(tokenValidity({ ...base, expires_at: new Date('2026-07-01') }, now)).toBe('expired')
  })

  test('revoked and banned take precedence', () => {
    expect(tokenValidity({ ...base, revoked_at: new Date() }, now)).toBe('revoked')
    expect(tokenValidity({ ...base, revoked_at: new Date(), user_banned: true }, now)).toBe('banned')
  })
})

describe('isValidScopeList', () => {
  test('accepts non-empty subsets of the known scopes', () => {
    expect(isValidScopeList(['migrations:read'])).toBe(true)
    expect(isValidScopeList([...API_TOKEN_SCOPES])).toBe(true)
  })

  test('rejects empty, unknown, duplicate, and non-array values', () => {
    expect(isValidScopeList([])).toBe(false)
    expect(isValidScopeList(['admin:everything'])).toBe(false)
    expect(isValidScopeList(['migrations:read', 'migrations:read'])).toBe(false)
    expect(isValidScopeList('migrations:read')).toBe(false)
    expect(isValidScopeList(undefined)).toBe(false)
  })
})

describe('TOKEN_ROUTES', () => {
  test('exposes only migration read/create — never approve, apply, or token management', () => {
    expect(Object.keys(TOKEN_ROUTES).sort()).toEqual([
      'GET /api/migrations',
      'GET /api/migrations/:id',
      'POST /api/migrations',
    ])
    expect(TOKEN_ROUTES['POST /api/migrations']).toBe('migrations:write')
  })
})

describe('parseCreateTokenInput', () => {
  const now = new Date('2026-07-16T00:00:00Z')
  const valid = { name: 'ci token', scopes: ['migrations:write'] }

  test('accepts a valid body, trimming the name', () => {
    const out = parseCreateTokenInput({ ...valid, name: '  ci token  ' }, now)
    expect(out).toEqual({ name: 'ci token', scopes: ['migrations:write'], expiresAt: null })
  })

  test('computes expiry from expires_in_days', () => {
    const out = parseCreateTokenInput({ ...valid, expires_in_days: 30 }, now)
    expect('expiresAt' in out && out.expiresAt?.toISOString()).toBe('2026-08-15T00:00:00.000Z')
  })

  test('rejects missing/blank/over-long names', () => {
    expect('error' in parseCreateTokenInput({ scopes: valid.scopes }, now)).toBe(true)
    expect('error' in parseCreateTokenInput({ ...valid, name: '   ' }, now)).toBe(true)
    expect('error' in parseCreateTokenInput({ ...valid, name: 'x'.repeat(101) }, now)).toBe(true)
  })

  test('rejects bad scopes and out-of-range expiry', () => {
    expect('error' in parseCreateTokenInput({ ...valid, scopes: [] }, now)).toBe(true)
    expect('error' in parseCreateTokenInput({ ...valid, scopes: ['nope'] }, now)).toBe(true)
    for (const days of [0, -1, 1.5, 366]) {
      expect('error' in parseCreateTokenInput({ ...valid, expires_in_days: days }, now)).toBe(true)
    }
  })

  test('a JSON null/undefined body is a 400, not a crash', () => {
    expect('error' in parseCreateTokenInput(null, now)).toBe(true)
    expect('error' in parseCreateTokenInput(undefined, now)).toBe(true)
  })
})

describe('rate limiting', () => {
  test('allows until max failures inside the window, then blocks', () => {
    const windows = new Map<string, RateWindow>()
    const t0 = 1_000_000
    for (let i = 0; i < 10; i++) {
      expect(rateLimitAllows(windows, 'ip1', t0 + i)).toBe(true)
      recordRateLimitFailure(windows, 'ip1', t0 + i)
    }
    expect(rateLimitAllows(windows, 'ip1', t0 + 100)).toBe(false)
  })

  test('window expiry resets the counter; keys are independent', () => {
    const windows = new Map<string, RateWindow>()
    const t0 = 1_000_000
    for (let i = 0; i < 10; i++) recordRateLimitFailure(windows, 'ip1', t0)
    expect(rateLimitAllows(windows, 'ip1', t0 + 59_999)).toBe(false)
    expect(rateLimitAllows(windows, 'ip1', t0 + 60_000)).toBe(true)
    expect(rateLimitAllows(windows, 'ip2', t0 + 1)).toBe(true)
  })

  test('expired windows are pruned so the map stays bounded', () => {
    const windows = new Map<string, RateWindow>()
    const t0 = 1_000_000
    recordRateLimitFailure(windows, 'ip1', t0)
    // An expired key is deleted on the next allow-check for it.
    expect(rateLimitAllows(windows, 'ip1', t0 + 60_000)).toBe(true)
    expect(windows.has('ip1')).toBe(false)
    // At the sweep threshold, recording a failure evicts all expired keys.
    for (let i = 0; i < 10_000; i++) windows.set(`k${i}`, { count: 1, windowStart: t0 })
    recordRateLimitFailure(windows, 'fresh', t0 + 60_000)
    expect(windows.size).toBe(1)
    expect(windows.has('fresh')).toBe(true)
  })
})
