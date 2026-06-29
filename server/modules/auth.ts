import { createHash, randomBytes } from 'node:crypto'
import { type Router, type Ctx, json, readJson, badRequest, forbidden } from '../lib/http'
import { query, queryOne, execute } from '../db/pool'
import { newId } from '../lib/ids'
import { verifyGoogleToken } from '../lib/google'
import { createSession, destroySession, sessionCookie, clearCookie } from '../lib/session'
import { env, ORG_LOCKED } from '../env'
import { LOCKED_ORG_ID } from '../db/init'
import type { SessionUser } from '../types'

const RESET_TTL_MS = 60 * 60 * 1000 // password-reset links live one hour
const MIN_PASSWORD_LENGTH = 8

function normalizeEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  // Pragmatic shape check; real validity is proven by the reset/sign-in flow.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Enter a valid email address.')
  return email
}

function requirePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  }
  return value
}

function requirePasswordAuth(): void {
  if (!env.passwordAuthEnabled) throw forbidden('Email/password authentication is disabled.')
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

function toSessionUser(row: Record<string, unknown>): SessionUser {
  return {
    id: row.id as string,
    email: row.email as string,
    name: row.name as string,
    picture: (row.picture as string) ?? null,
    role: row.role as SessionUser['role'],
  }
}

// Find-or-provision the user for a verified Google profile.
async function provisionUser(profile: { email: string; name: string; picture: string | null }): Promise<SessionUser> {
  const existing = await queryOne<Record<string, unknown>>('SELECT * FROM users WHERE email = :email', {
    email: profile.email,
  })

  if (existing) {
    if (existing.is_banned) throw forbidden('Your account has been suspended.')
    await execute('UPDATE users SET name = :name, picture = :picture, last_login_at = NOW() WHERE id = :id', {
      name: profile.name,
      picture: profile.picture,
      id: existing.id,
    })
    const user = toSessionUser(existing)
    if (ORG_LOCKED) await ensureLockedMembership(user.id)
    return user
  }

  // Bootstrap: the very first user becomes an admin. Otherwise sign-in requires
  // a prior invite (the email must already exist as a user row).
  const [{ n }] = await query<{ n: number }>('SELECT COUNT(*) AS n FROM users')
  if (n > 0 && !ORG_LOCKED) throw forbidden('account_not_provisioned')

  const id = newId('u')
  const role = n === 0 ? 'admin' : 'viewer'
  await execute(
    'INSERT INTO users (id, email, name, picture, role, last_login_at) VALUES (:id, :email, :name, :picture, :role, NOW())',
    { id, email: profile.email, name: profile.name, picture: profile.picture, role },
  )
  if (ORG_LOCKED) await ensureLockedMembership(id)
  return { id, email: profile.email, name: profile.name, picture: profile.picture, role }
}

async function ensureLockedMembership(userId: string): Promise<void> {
  await execute('INSERT IGNORE INTO memberships (org_id, user_id) VALUES (:org, :user)', {
    org: LOCKED_ORG_ID,
    user: userId,
  })
}

// Create (or claim) an account with an email/password. Mirrors the provisioning
// rules of the Google flow: the first ever user becomes admin; otherwise a row
// must already exist (an invite) unless the deployment is org-locked.
async function registerWithPassword(name: string, email: string, password: string): Promise<SessionUser> {
  const existing = await queryOne<Record<string, unknown>>('SELECT * FROM users WHERE email = :email', { email })
  const hash = await Bun.password.hash(password)

  if (existing) {
    if (existing.is_banned) throw forbidden('Your account has been suspended.')
    // Only an unclaimed invite (never signed in, no password) may set a password
    // here. An account that already has a password or has authenticated via
    // Google must use sign-in / reset — this prevents takeover of a known email.
    if (existing.password_hash || existing.last_login_at) {
      throw badRequest('An account with this email already exists. Sign in instead.')
    }
    await execute(
      `UPDATE users SET name = COALESCE(NULLIF(:name, ''), name), password_hash = :hash, last_login_at = NOW()
        WHERE id = :id`,
      { name, hash, id: existing.id },
    )
    const user = toSessionUser({ ...existing, name: name || existing.name })
    if (ORG_LOCKED) await ensureLockedMembership(user.id)
    return user
  }

  const [{ n }] = await query<{ n: number }>('SELECT COUNT(*) AS n FROM users')
  if (n > 0 && !ORG_LOCKED) throw forbidden('account_not_provisioned')

  const id = newId('u')
  const role = n === 0 ? 'admin' : 'viewer'
  await execute(
    'INSERT INTO users (id, email, name, password_hash, role, last_login_at) VALUES (:id, :email, :name, :hash, :role, NOW())',
    { id, email, name, hash, role },
  )
  if (ORG_LOCKED) await ensureLockedMembership(id)
  return { id, email, name, picture: null, role }
}

// Authenticate an existing password account. Uses a single generic error so the
// endpoint never reveals whether an email is registered.
async function authenticateWithPassword(email: string, password: string): Promise<SessionUser> {
  const invalid = badRequest('Invalid email or password.')
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM users WHERE email = :email', { email })
  if (!row || !row.password_hash) throw invalid
  if (row.is_banned) throw forbidden('Your account has been suspended.')
  const ok = await Bun.password.verify(password, row.password_hash as string)
  if (!ok) throw invalid
  await execute('UPDATE users SET last_login_at = NOW() WHERE id = :id', { id: row.id })
  const user = toSessionUser(row)
  if (ORG_LOCKED) await ensureLockedMembership(user.id)
  return user
}

export function registerAuth(router: Router) {
  // Current session.
  router.get('/api/auth/me', (ctx: Ctx) => json({ authenticated: !!ctx.user, user: ctx.user ?? null }))

  // The client obtains a Google ID token (credential) and posts it here.
  router.post('/api/auth/google', async (ctx: Ctx) => {
    const body = await readJson<{ credential?: string }>(ctx.req)
    if (!body.credential) throw badRequest('Missing Google credential.')
    const profile = await verifyGoogleToken(body.credential)
    const user = await provisionUser(profile)
    const token = await createSession(user.id)
    return json({ authenticated: true, user }, { headers: { 'set-cookie': sessionCookie(token) } })
  })

  router.post('/api/auth/logout', async (ctx: Ctx) => {
    if (ctx.sessionId) await destroySession(ctx.sessionId)
    return new Response(null, { status: 204, headers: { 'set-cookie': clearCookie() } })
  })

  // --- Email / password ----------------------------------------------------

  router.post('/api/auth/signup', async (ctx: Ctx) => {
    requirePasswordAuth()
    const body = await readJson<{ name?: string; email?: string; password?: string }>(ctx.req)
    const email = normalizeEmail(body.email)
    const password = requirePassword(body.password)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const user = await registerWithPassword(name, email, password)
    const token = await createSession(user.id)
    return json({ authenticated: true, user }, { headers: { 'set-cookie': sessionCookie(token) } })
  })

  router.post('/api/auth/login', async (ctx: Ctx) => {
    requirePasswordAuth()
    const body = await readJson<{ email?: string; password?: string }>(ctx.req)
    const email = normalizeEmail(body.email)
    const password = requirePassword(body.password)
    const user = await authenticateWithPassword(email, password)
    const token = await createSession(user.id)
    return json({ authenticated: true, user }, { headers: { 'set-cookie': sessionCookie(token) } })
  })

  // Request a reset link. Always responds the same way regardless of whether the
  // email exists, to avoid account enumeration. There is no SMTP transport wired
  // here, so the link is logged server-side (an email integration would send it).
  router.post('/api/auth/forgot-password', async (ctx: Ctx) => {
    requirePasswordAuth()
    const body = await readJson<{ email?: string }>(ctx.req)
    const email = normalizeEmail(body.email)
    const user = await queryOne<{ id: string; password_hash: string | null }>(
      'SELECT id, password_hash FROM users WHERE email = :email',
      { email },
    )
    if (user?.password_hash) {
      const token = randomBytes(32).toString('base64url')
      const expires = new Date(Date.now() + RESET_TTL_MS)
      // One outstanding link per user: drop any earlier tokens first.
      await execute('DELETE FROM password_resets WHERE user_id = :id', { id: user.id })
      await execute(
        'INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (:hash, :id, :expires)',
        { hash: sha256(token), id: user.id, expires },
      )
      const base = env.appBaseUrl || ctx.url.origin
      console.log(`[password-reset] Reset link for ${email}: ${base}/reset-password?token=${token}`)
    }
    return json({ ok: true })
  })

  router.post('/api/auth/reset-password', async (ctx: Ctx) => {
    requirePasswordAuth()
    const body = await readJson<{ token?: string; password?: string }>(ctx.req)
    const token = typeof body.token === 'string' ? body.token : ''
    const password = requirePassword(body.password)
    if (!token) throw badRequest('This reset link is invalid or has expired.')

    const reset = await queryOne<{ user_id: string }>(
      `SELECT user_id FROM password_resets
        WHERE token_hash = :hash AND used_at IS NULL AND expires_at > NOW()`,
      { hash: sha256(token) },
    )
    if (!reset) throw badRequest('This reset link is invalid or has expired.')

    const row = await queryOne<Record<string, unknown>>('SELECT * FROM users WHERE id = :id', { id: reset.user_id })
    if (!row) throw badRequest('This reset link is invalid or has expired.')
    if (row.is_banned) throw forbidden('Your account has been suspended.')

    const hash = await Bun.password.hash(password)
    await execute('UPDATE users SET password_hash = :hash WHERE id = :id', { hash, id: reset.user_id })
    await execute('UPDATE password_resets SET used_at = NOW() WHERE token_hash = :hash', { hash: sha256(token) })
    // Invalidate every existing session so a leaked one can't outlive the reset.
    await execute('DELETE FROM sessions WHERE user_id = :id', { id: reset.user_id })

    const user = toSessionUser(row)
    const newToken = await createSession(user.id)
    return json({ authenticated: true, user }, { headers: { 'set-cookie': sessionCookie(newToken) } })
  })
}
