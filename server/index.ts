// Checkpoint backend — Bun + TypeScript + MySQL.
// Serves the JSON API under /api/* and the built SPA for everything else.

import { env } from './env'
import { initDb } from './db/init'
import { startScheduler } from './lib/scheduler'
import { Router, HttpError, json, type Ctx } from './lib/http'
import { getSessionUser } from './lib/session'

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

const distDir = `${import.meta.dir}/../dist`

// Decide which Origin (if any) may make credentialed cross-origin calls.
function resolveCorsOrigin(req: Request): string | null {
  const origin = req.headers.get('origin')
  if (!origin) return null
  const normalized = origin.replace(/\/$/, '')
  if (env.corsOrigins.length > 0) {
    return env.corsOrigins.includes(normalized) ? origin : null
  }
  // Dev default: allow any localhost / 127.0.0.1 origin (any port or scheme).
  if (!env.isProd) {
    try {
      const host = new URL(origin).hostname
      if (host === 'localhost' || host === '127.0.0.1') return origin
    } catch {}
  }
  return null
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

async function handleApi(req: Request, url: URL): Promise<Response> {
  if (url.pathname === '/api/health') return json({ status: 'ok', timestamp: new Date().toISOString() })

  const match = router.match(req.method, url.pathname)
  if (!match) return json({ error: 'Not found' }, { status: 404 })

  const session = await getSessionUser(req)
  const ctx: Ctx = {
    req,
    url,
    params: match.params,
    query: url.searchParams,
    user: session?.user,
    sessionId: session?.sessionId,
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
  async fetch(req) {
    const url = new URL(req.url)
    const allowOrigin = url.pathname.startsWith('/api/') ? resolveCorsOrigin(req) : null

    // Answer the browser's CORS preflight before any routing/auth.
    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, { status: 204, headers: allowOrigin ? corsHeaders(allowOrigin) : {} })
    }

    try {
      if (url.pathname.startsWith('/api/')) {
        const res = await handleApi(req, url)
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
