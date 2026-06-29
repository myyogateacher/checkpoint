// Checkpoint backend — Bun + TypeScript + MySQL.
// Serves the JSON API under /api/* and the built SPA for everything else.

import { env } from './env'
import { initDb } from './db/init'
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

const server = Bun.serve({
  port: env.port,
  async fetch(req) {
    const url = new URL(req.url)
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, url)
      return await serveStatic(url)
    } catch (err) {
      console.error(err)
      return json({ error: 'Internal server error' }, { status: 500 })
    }
  },
})

console.log(`Checkpoint server listening on http://localhost:${server.port}`)
