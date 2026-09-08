import { createHash, randomBytes } from 'node:crypto'
import { execute, queryOne } from '../db/pool'
import { asJson } from './serialize'
import type { ApiTokenScope, SessionUser } from '../types'

// Personal access tokens: `chk_` + 32 random bytes (base64url); only the SHA-256 hash is stored.

export const TOKEN_SECRET_PREFIX = 'chk_'
// Shown in list views so a token can be identified without revealing it.
export const TOKEN_DISPLAY_PREFIX_LENGTH = 12

export const API_TOKEN_SCOPES: ApiTokenScope[] = [
  'migrations:read',
  'migrations:write',
  'catalog:read',
  'queries:read',
  'audit:read',
]

// Every scope — the MCP endpoint admits a token holding any one of them, and then
// enforces the per-tool scope itself (see server/modules/mcp.ts).
const ANY_SCOPE: ApiTokenScope[] = [...API_TOKEN_SCOPES]

// Routes reachable with Bearer auth ("METHOD /registered-path" → required scope);
// everything else is session-only. A list means any-of: one matching scope suffices.
export const TOKEN_ROUTES: Record<string, ApiTokenScope | ApiTokenScope[]> = {
  'GET /api/migrations': 'migrations:read',
  'GET /api/migrations/:id': 'migrations:read',
  'POST /api/migrations': 'migrations:write',
  'PATCH /api/migrations/:id': 'migrations:write',
  'POST /api/mcp': ANY_SCOPE,
  // Registered only to answer with 405 + Allow: POST instead of a bare 404.
  'GET /api/mcp': ANY_SCOPE,
  'DELETE /api/mcp': ANY_SCOPE,
}

// True when `scopes` satisfies a TOKEN_ROUTES requirement (any-of for a list).
export function satisfiesRequirement(
  scopes: ApiTokenScope[],
  required: ApiTokenScope | ApiTokenScope[],
): boolean {
  return Array.isArray(required) ? required.some((r) => scopes.includes(r)) : scopes.includes(required)
}

// Implied scopes. `migrations:read` also grants `catalog:read`, because migration
// ids are meaningless without resolving the project/environment/database they
// belong to, and the catalog exposes no secrets (connection passwords are
// write-only and never serialized). `queries:read` and `audit:read` are never
// implied — reading arbitrary table data or the org's audit trail is a distinct,
// explicit grant.
export function effectiveScopes(stored: ApiTokenScope[]): ApiTokenScope[] {
  const out = new Set<ApiTokenScope>(stored)
  if (out.has('migrations:read')) out.add('catalog:read')
  return [...out]
}

export function generateApiToken(): { token: string; hash: string; prefix: string } {
  const token = `${TOKEN_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`
  return { token, hash: hashApiToken(token), prefix: token.slice(0, TOKEN_DISPLAY_PREFIX_LENGTH) }
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// A chk_ Bearer secret, or null (foreign bearers like proxy JWTs fall through to session auth).
export function readBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization')
  if (!header) return null
  const secret = header.trim().match(/^bearer\s+(\S+)$/i)?.[1] ?? ''
  return secret.startsWith(TOKEN_SECRET_PREFIX) ? secret : null
}

export type TokenValidity = 'ok' | 'expired' | 'revoked' | 'banned'

export function tokenValidity(
  row: { expires_at: Date | null; revoked_at: Date | null; user_banned: boolean },
  now: Date,
): TokenValidity {
  if (row.user_banned) return 'banned'
  if (row.revoked_at) return 'revoked'
  if (row.expires_at && row.expires_at.getTime() <= now.getTime()) return 'expired'
  return 'ok'
}

export function isValidScopeList(scopes: unknown): scopes is ApiTokenScope[] {
  return (
    Array.isArray(scopes) &&
    scopes.length > 0 &&
    scopes.every((s) => (API_TOKEN_SCOPES as string[]).includes(s as string)) &&
    new Set(scopes).size === scopes.length
  )
}

export const MAX_TOKEN_EXPIRY_DAYS = 365

// Validate a create-token body (any JSON value, incl. null) into insert-ready values or a 400 message.
export function parseCreateTokenInput(
  body: { name?: string; scopes?: unknown; expires_in_days?: number | null } | null | undefined,
  now: Date,
): { name: string; scopes: ApiTokenScope[]; expiresAt: Date | null } | { error: string } {
  const name = body?.name?.trim()
  const scopes = body?.scopes
  if (!name) return { error: 'A token name is required.' }
  if (name.length > 100) return { error: 'Token name must be 100 characters or fewer.' }
  if (!isValidScopeList(scopes)) return { error: 'scopes must be a non-empty list of known scopes.' }
  const days = body?.expires_in_days ?? null
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > MAX_TOKEN_EXPIRY_DAYS)) {
    return { error: `expires_in_days must be between 1 and ${MAX_TOKEN_EXPIRY_DAYS}, or null for no expiry.` }
  }
  return { name, scopes, expiresAt: days === null ? null : new Date(now.getTime() + days * 86_400_000) }
}

// --- Failed-attempt rate limiting (fixed window, in-memory) -------------------

export interface RateWindow {
  count: number
  windowStart: number
}

export const RATE_LIMIT_MAX_FAILURES = 10
export const RATE_LIMIT_WINDOW_MS = 60_000
// Sweep expired windows once the map holds this many keys, keeping memory bounded.
export const RATE_LIMIT_SWEEP_SIZE = 10_000

export function rateLimitAllows(
  windows: Map<string, RateWindow>,
  key: string,
  now: number,
  max = RATE_LIMIT_MAX_FAILURES,
  windowMs = RATE_LIMIT_WINDOW_MS,
): boolean {
  const w = windows.get(key)
  if (!w) return true
  if (now - w.windowStart >= windowMs) {
    windows.delete(key)
    return true
  }
  return w.count < max
}

export function recordRateLimitFailure(
  windows: Map<string, RateWindow>,
  key: string,
  now: number,
  windowMs = RATE_LIMIT_WINDOW_MS,
): void {
  if (windows.size >= RATE_LIMIT_SWEEP_SIZE) {
    for (const [k, w] of windows) if (now - w.windowStart >= windowMs) windows.delete(k)
  }
  const w = windows.get(key)
  if (!w || now - w.windowStart >= windowMs) {
    windows.set(key, { count: 1, windowStart: now })
    return
  }
  w.count += 1
}

// --- Resolution (I/O) ----------------------------------------------------------

export interface ResolvedApiToken {
  user: SessionUser
  token: { id: string; name: string; scopes: ApiTokenScope[] }
}

// Resolve a Bearer secret to its owning user; null when unknown/expired/revoked/banned.
export async function resolveApiToken(secret: string): Promise<ResolvedApiToken | null> {
  if (!secret.startsWith(TOKEN_SECRET_PREFIX)) return null
  const row = await queryOne<{
    id: string
    name: string
    scopes: unknown
    expires_at: Date | null
    revoked_at: Date | null
    user_id: string
    email: string
    user_name: string
    picture: string | null
    role: SessionUser['role']
    is_banned: number
  }>(
    `SELECT t.id, t.name, t.scopes, t.expires_at, t.revoked_at,
            u.id AS user_id, u.email, u.name AS user_name, u.picture, u.role, u.is_banned
       FROM api_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = :hash`,
    { hash: hashApiToken(secret) },
  )
  if (!row) return null
  const validity = tokenValidity(
    { expires_at: row.expires_at, revoked_at: row.revoked_at, user_banned: !!row.is_banned },
    new Date(),
  )
  if (validity !== 'ok') return null
  return {
    user: { id: row.user_id, email: row.email, name: row.user_name, picture: row.picture, role: row.role },
    // Expanded once here so REST route checks and MCP tool checks see the same set.
    token: { id: row.id, name: row.name, scopes: effectiveScopes(asJson<ApiTokenScope[]>(row.scopes, [])) },
  }
}

export async function touchApiToken(id: string): Promise<void> {
  await execute('UPDATE api_tokens SET last_used_at = NOW() WHERE id = :id', { id })
}
