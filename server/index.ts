// Checkpoint backend — Bun + TypeScript + MySQL.
// Serves the JSON API under /api/* and the built SPA for everything else.

import { env } from './env'
import { initDb } from './db/init'
import { startScheduler } from './lib/scheduler'
import { Router, HttpError, json, type Ctx } from './lib/http'
import { getSessionUser } from './lib/session'
import { resolveCorsOrigin } from './lib/cors'
import {
  TOKEN_ROUTES,
  rateLimitAllows,
  readBearerToken,
  recordRateLimitFailure,
  resolveApiToken,
  satisfiesRequirement,
  touchApiToken,
  type RateWindow,
} from './lib/apiTokens'

import { registerAuth } from './modules/auth'
import { registerOrganizations } from './modules/organizations'
import { registerProjects } from './modules/projects'
import { registerEnvironments } from './modules/environments'
import { registerDatabases } from './modules/databases'
import { registerSchema } from './modules/schema'
import { registerQuery } from './modules/query'
import { registerMigrations, registerProjectMigrations } from './modules/migrations'
import { registerSavedQueries } from './modules/savedQueries'
import { registerSettings } from './modules/settings'
import { registerValidationRules } from './modules/validationRules'
import { registerUsers } from './modules/users'
import { registerAudit } from './modules/audit'
import { registerApiTokens } from './modules/apiTokens'
import { registerMcp } from './modules/mcp'

const router = new Router()
registerAuth(router)
registerOrganizations(router)
registerProjects(router)
registerEnvironments(router)
registerDatabases(router)
registerSchema(router)
registerQuery(router)
registerMigrations(router)
registerProjectMigrations(router)
registerSavedQueries(router)
registerSettings(router)
registerValidationRules(router)
registerUsers(router)
registerAudit(router)
registerApiTokens(router)
registerMcp(router)

const distDir = `${import.meta.dir}/../dist`

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    // The mcp-* / last-event-id headers are what a browser-based MCP client sends.
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, mcp-session-id, mcp-protocol-version, last-event-id',
    'Access-Control-Expose-Headers': 'mcp-session-id',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

// Failed Bearer attempts per client IP, so an attacker can't grind token guesses.
const bearerFailures = new Map<string, RateWindow>()

// Bearer auth for a matched route: null → no chk_ bearer (use session); else ctx fields or an error Response.
async function authenticateBearer(
  req: Request,
  routeKey: string,
  clientIp: string,
): Promise<{ user: Ctx['user']; apiToken: Ctx['apiToken'] } | Response | null> {
  const secret = readBearerToken(req)
  if (secret === null) return null

  // Allowlist first: off-list requests must not cost a DB lookup or a rate-window hit.
  const requiredScope = TOKEN_ROUTES[routeKey]
  if (!requiredScope) {
    return json({ error: 'This endpoint does not support API token authentication.' }, { status: 403 })
  }
  if (!rateLimitAllows(bearerFailures, clientIp, Date.now())) {
    return json({ error: 'Too many failed token attempts. Try again shortly.' }, { status: 429 })
  }
  const resolved = await resolveApiToken(secret)
  if (!resolved) {
    recordRateLimitFailure(bearerFailures, clientIp, Date.now())
    return json({ error: 'Invalid, expired, or revoked API token.' }, { status: 401 })
  }
  if (!satisfiesRequirement(resolved.token.scopes, requiredScope)) {
    const needed = Array.isArray(requiredScope) ? requiredScope.join(' or ') : requiredScope
    return json({ error: `This token lacks the ${needed} scope.` }, { status: 403 })
  }
  // last_used_at is display-only bookkeeping — never block or fail the request on it.
  void touchApiToken(resolved.token.id).catch((err) => console.error('token touch failed:', err))
  return { user: resolved.user, apiToken: resolved.token }
}

async function handleApi(req: Request, url: URL, clientIp: string): Promise<Response> {
  if (url.pathname === '/api/health') return json({ status: 'ok', timestamp: new Date().toISOString() })

  const match = router.match(req.method, url.pathname)
  if (!match) return json({ error: 'Not found' }, { status: 404 })

  const ctx: Ctx = { req, url, params: match.params, query: url.searchParams }
  const bearer = await authenticateBearer(req, `${req.method} ${match.path}`, clientIp)
  if (bearer instanceof Response) return bearer
  if (bearer) {
    ctx.user = bearer.user
    ctx.apiToken = bearer.apiToken
  } else {
    const session = await getSessionUser(req)
    ctx.user = session?.user
    ctx.sessionId = session?.sessionId
  }
  try {
    return await match.handler(ctx)
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, { status: err.status })
    console.error('Unhandled error:', err)
    return json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function serveStatic(url: URL): Promise<Response> {
  const filePath = url.pathname === '/' ? '/index.html' : url.pathname
  const file = Bun.file(`${distDir}${filePath}`)
  if (await file.exists()) return new Response(file)
  // SPA fallback for client-side routes.
  return new Response(Bun.file(`${distDir}/index.html`), { headers: { 'content-type': 'text/html' } })
}

await initDb()
startScheduler()

const server = Bun.serve({
  port: env.port,
  async fetch(req, srv) {
    const url = new URL(req.url)
    const allowOrigin = url.pathname.startsWith('/api/') ? resolveCorsOrigin(req) : null

    // Answer the browser's CORS preflight before any routing/auth.
    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, { status: 204, headers: allowOrigin ? corsHeaders(allowOrigin) : {} })
    }

    try {
      if (url.pathname.startsWith('/api/')) {
        // Socket address, not x-forwarded-for — rate-limit keys must not be client-spoofable.
        const res = await handleApi(req, url, srv.requestIP(req)?.address ?? 'unknown')
        if (allowOrigin) {
          for (const [k, v] of Object.entries(corsHeaders(allowOrigin))) res.headers.set(k, v)
        }
        return res
      }
      return await serveStatic(url)
    } catch (err) {
      console.error(err)
      const res = json({ error: 'Internal server error' }, { status: 500 })
      if (allowOrigin) {
        for (const [k, v] of Object.entries(corsHeaders(allowOrigin))) res.headers.set(k, v)
      }
      return res
    }
  },
})

console.log(`Checkpoint server listening on http://localhost:${server.port}`)
