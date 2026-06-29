import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '../env'
import { execute, queryOne } from '../db/pool'
import { cookieHeader, parseCookies } from './http'
import type { SessionUser } from '../types'

const COOKIE = 'checkpoint_session'

// The cookie carries `sessionId.signature`; the signature is an HMAC of the id,
// so a tampered cookie is rejected before any DB lookup.
function sign(value: string): string {
  return createHmac('sha256', env.sessionSecret).update(value).digest('base64url')
}

export async function createSession(userId: string): Promise<string> {
  const id = randomBytes(24).toString('base64url')
  const expires = new Date(Date.now() + env.sessionTtlDays * 86400_000)
  await execute('INSERT INTO sessions (id, user_id, expires_at) VALUES (:id, :user_id, :expires_at)', {
    id,
    user_id: userId,
    expires_at: expires,
  })
  return `${id}.${sign(id)}`
}

const COOKIE_SAME_SITE = env.crossSiteCookies ? 'None' : 'Lax'
const COOKIE_SECURE = env.isProd || env.crossSiteCookies

export function sessionCookie(token: string): string {
  return cookieHeader(COOKIE, token, { maxAge: env.sessionTtlDays * 86400, secure: COOKIE_SECURE, sameSite: COOKIE_SAME_SITE })
}
export function clearCookie(): string {
  return cookieHeader(COOKIE, '', { maxAge: 0, secure: COOKIE_SECURE, sameSite: COOKIE_SAME_SITE })
}

function readToken(req: Request): string | null {
  const raw = parseCookies(req)[COOKIE]
  if (!raw) return null
  const [id, sig] = raw.split('.')
  if (!id || !sig) return null
  const expected = sign(id)
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  return id
}

// Resolve the signed-in user from the request cookie, or null.
export async function getSessionUser(req: Request): Promise<{ user: SessionUser; sessionId: string } | null> {
  const id = readToken(req)
  if (!id) return null
  const row = await queryOne<{
    id: string
    email: string
    name: string
    picture: string | null
    role: SessionUser['role']
    is_banned: number
  }>(
    `SELECT u.id, u.email, u.name, u.picture, u.role, u.is_banned
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = :id AND s.expires_at > NOW()`,
    { id },
  )
  if (!row || row.is_banned) return null
  return {
    sessionId: id,
    user: { id: row.id, email: row.email, name: row.name, picture: row.picture, role: row.role },
  }
}

export async function destroySession(sessionId: string): Promise<void> {
  await execute('DELETE FROM sessions WHERE id = :id', { id: sessionId })
}
