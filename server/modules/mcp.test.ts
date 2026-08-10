import { describe, expect, test } from 'bun:test'
import { handleMcpRequest, mcpMethodNotAllowed, registerMcp, type McpPrincipal } from './mcp'
import { Router } from '../lib/http'
import { TOKEN_ROUTES } from '../lib/apiTokens'
import type { ApiTokenScope, SessionUser } from '../types'

// These exercise the transport and the scope gate only — no tool that reaches the
// database is called, so no MySQL is needed.

const ALL_SCOPES: ApiTokenScope[] = [
  'migrations:read',
  'migrations:write',
  'catalog:read',
  'queries:read',
  'audit:read',
]

const admin: SessionUser = { id: 'u_1', email: 'admin@myt.com', name: 'Admin', picture: null, role: 'admin' }

const principal = (scopes: ApiTokenScope[] = ALL_SCOPES): McpPrincipal => ({
  user: admin,
  scopes,
  tokenName: 'agent token',
  baseUrl: 'https://checkpoint.example.com',
})

const PROTOCOL_VERSION = '2025-06-18'

// A single JSON-RPC POST, shaped the way a Streamable HTTP client sends it.
function rpc(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://checkpoint.example.com/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL_VERSION,
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

async function call(body: unknown, p = principal(), headers: Record<string, string> = {}) {
  const res = await handleMcpRequest(rpc(body, headers), p)
  return { res, json: (await res.json()) as Record<string, any> }
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.0.0' },
  },
}

const TOOLS_LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }

describe('MCP transport', () => {
  test('initialize negotiates and identifies the server', async () => {
    const { res, json } = await call(INITIALIZE)
    expect(res.status).toBe(200)
    expect(json.id).toBe(1)
    expect(json.result.serverInfo.name).toBe('checkpoint')
    expect(json.result.capabilities.tools).toBeDefined()
    // Stateless: no session for the client to carry.
    expect(res.headers.get('mcp-session-id')).toBeNull()
  })

  test('tools/list works without a session (stateless request/response)', async () => {
    const { res, json } = await call(TOOLS_LIST)
    expect(res.status).toBe(200)
    expect(Array.isArray(json.result.tools)).toBe(true)
  })

  test('a notification-only POST is accepted with 202 and no body', async () => {
    const res = await handleMcpRequest(rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }), principal())
    expect(res.status).toBe(202)
  })

  test('GET and DELETE are refused with 405 and Allow: POST', () => {
    const res = mcpMethodNotAllowed()
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
  })

  test('a disallowed Origin is rejected (DNS-rebinding protection)', async () => {
    const res = await handleMcpRequest(rpc(TOOLS_LIST, { origin: 'https://evil.example.com' }), principal())
    expect(res.status).toBe(403)
  })
})

describe('MCP tool surface', () => {
  async function toolNames(p = principal()): Promise<string[]> {
    const { json } = await call(TOOLS_LIST, p)
    return (json.result.tools as Array<{ name: string }>).map((t) => t.name).sort()
  }

  test('exposes exactly the intended tools', async () => {
    expect(await toolNames()).toEqual([
      'add_migration_comment',
      'create_migration',
      'get_database_schema',
      'get_migration',
      'list_audit_events',
      'list_databases',
      'list_environments',
      'list_migrations',
      'list_pending_approvals',
      'list_projects',
      'list_saved_queries',
      'run_saved_query',
    ])
  })

  // The product invariant, asserted on the wire: an agent is never even offered a
  // governance verb, whatever scopes its token holds.
  test('no tool exists for approve, reject, apply, schedule, submit, or arbitrary SQL', async () => {
    const names = await toolNames()
    for (const forbidden of [
      'approve',
      'reject',
      'apply',
      'schedule',
      'cancel',
      'submit',
      'run_query',
      'set_reviewers',
      'reviewers',
    ]) {
      expect(names.filter((n) => n.includes(forbidden))).toEqual([])
    }
  })

  test('only the two migration-write tools are non-read-only', async () => {
    const { json } = await call(TOOLS_LIST)
    const tools = json.result.tools as Array<{ name: string; annotations?: { readOnlyHint?: boolean } }>
    const mutating = tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name).sort()
    expect(mutating).toEqual(['add_migration_comment', 'create_migration'])
  })

  test('the tool list does not depend on the token scopes — the gate is per call', async () => {
    // Listing everything keeps the scope error discoverable rather than silently
    // hiding capability the owner could grant.
    expect(await toolNames(principal(['migrations:read']))).toEqual(await toolNames())
  })
})

describe('registerMcp', () => {
  test('registers only POST/GET/DELETE /api/mcp, and each is on the Bearer allowlist', () => {
    const router = new Router()
    registerMcp(router)
    for (const method of ['POST', 'GET', 'DELETE']) {
      const match = router.match(method, '/api/mcp')
      expect(match).not.toBeNull()
      // Off-allowlist routes are 403'd before the handler, so a registered MCP
      // route that is missing here would be unreachable with a token.
      expect(TOKEN_ROUTES[`${method} /api/mcp`]).toBeDefined()
    }
    // No sub-paths: the whole protocol rides one endpoint.
    expect(router.match('POST', '/api/mcp/tools')).toBeNull()
  })

  test('the endpoint requires a token — a session-only ctx is refused with 401', async () => {
    const router = new Router()
    registerMcp(router)
    const match = router.match('POST', '/api/mcp')!
    const res = await match.handler({
      req: rpc(TOOLS_LIST),
      url: new URL('https://checkpoint.example.com/api/mcp'),
      params: {},
      query: new URLSearchParams(),
      user: admin, // signed in, but no apiToken
    })
    expect(res.status).toBe(401)
  })
})

describe('MCP scope enforcement', () => {
  async function callTool(name: string, args: Record<string, unknown>, scopes: ApiTokenScope[]) {
    const { json } = await call(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } },
      principal(scopes),
    )
    return json.result as { isError?: boolean; content: Array<{ text: string }> }
  }

  test('a tool whose scope is missing fails before touching the database', async () => {
    const result = await callTool('list_audit_events', {}, ['migrations:read'])
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/lacks the audit:read scope/)
  })

  test('queries:read is not implied by migrations:read', async () => {
    const result = await callTool('run_saved_query', { saved_query_id: 'sq_1' }, ['migrations:read'])
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/lacks the queries:read scope/)
  })

  test('migrations:write is required to create a migration', async () => {
    const result = await callTool(
      'create_migration',
      { database_id: 'db_1', title: 'x', queries: ['SELECT 1'] },
      ['migrations:read'],
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/lacks the migrations:write scope/)
  })

  test('a read tool with no scope at all is refused', async () => {
    const result = await callTool('list_projects', {}, [])
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/lacks the catalog:read scope/)
  })

  test('bad arguments are reported as a tool error, not a crash', async () => {
    const result = await callTool('get_migration', {}, ['migrations:read'])
    expect(result.isError).toBe(true)
  })
})
