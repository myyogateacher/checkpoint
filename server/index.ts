// ---------------------------------------------------------------------------
// Stubbed Bun backend. The frontend currently runs against in-memory mock data
// (see src/services/api.ts, USE_MOCKS = true). This server exists so the dev
// and Docker workflows are wired up; real routes are implemented later.
//
// Planned routes (contract lives in src/types.ts):
//   GET  /api/health
//   GET  /api/auth/me            POST /api/auth/logout
//   GET  /api/auth/google        GET  /api/auth/google/callback
//   CRUD /api/projects · /api/projects/:id/environments · /api/databases
//   GET  /api/databases/:id/schema     POST /api/databases/:id/schema/sync
//   POST /api/databases/:id/query      (read-only, via read connection)
//   CRUD /api/migrations + /:id/{submit,approve,reject,apply}
//   CRUD /api/users · GET /api/audit-logs
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT ?? 3001)
const distDir = `${import.meta.dir}/../dist`

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === '/api/health') {
      return Response.json({ status: 'ok', stub: true, timestamp: new Date().toISOString() })
    }

    if (url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'Not implemented — backend is stubbed.' }, { status: 501 })
    }

    // Serve the built SPA in production; fall back to index.html for client routes.
    const filePath = url.pathname === '/' ? '/index.html' : url.pathname
    const file = Bun.file(`${distDir}${filePath}`)
    if (await file.exists()) return new Response(file)
    return new Response(Bun.file(`${distDir}/index.html`))
  },
})

console.log(`Checkpoint stub server listening on http://localhost:${server.port}`)
