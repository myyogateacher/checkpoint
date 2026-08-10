// MCP (Model Context Protocol) endpoint — POST /api/mcp.
//
// Lets an agent read Checkpoint's catalog, migrations, saved queries and audit
// trail, and open migrations for review. Every tool calls the same helper the REST
// handler calls, so organization membership, role checks and validation behave
// identically here and in the UI.
//
// GOVERNANCE: there are deliberately NO tools for approve, reject, apply,
// schedule, cancel-schedule, standalone submit, set-reviewers, or arbitrary SQL.
// Those verbs are what put SQL on a real database and stay a human decision made
// in a browser session. Omitting the tools is only the first layer — the Bearer
// allowlist keeps those routes session-only, and `assertNotTokenPrincipal` in
// modules/migrations.ts refuses them at the point of action for any token
// principal. Do not add a governance tool here.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'

import { type Router, type Ctx, json, HttpError } from '../lib/http'
import { isAllowedOrigin } from '../lib/cors'
import { can } from '../lib/auth'
import { env } from '../env'
import type { ApiTokenScope, SessionUser } from '../types'

import { listProjects, listProjectEnvironments, toProject } from './projects'
import { listEnvironments } from './environments'
import { listDatabases } from './databases'
import { loadDb, serializeDb, getConnectionSecret } from './databases.repo'
import { getDatabaseSchema } from './schema'
import { listSavedQueries, loadSavedQuery, toSq } from './savedQueries'
import { listAuditEvents, toAuditEvent } from './audit'
import { resolveTimeoutMs } from './query'
import { runReadQuery, assertReadOnly } from '../lib/externalDb'
import { writeAudit } from '../lib/audit'
import {
  listMigrations,
  loadMig,
  fullMigration,
  createMigration,
  addMigrationComment,
} from './migrations'

const SERVER_NAME = 'checkpoint'
const SERVER_VERSION = '1.2.0'

// What the request is allowed to do: the calling user plus the token's effective
// scopes (already expanded by resolveApiToken).
export interface McpPrincipal {
  user: SessionUser
  scopes: ApiTokenScope[]
  tokenName: string
  baseUrl: string
}

// Mirrors the SDK's CallToolResult, including its open index signature.
interface ToolResult {
  [key: string]: unknown
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

// Tool results are JSON-in-text: the shape agents handle most reliably.
function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function fail(message: string): ToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

// Wrap a tool body: enforce its scope, and turn thrown HttpErrors (403 from an org
// check, 400 from validation) into tool errors the agent can read and act on.
function tool<A>(
  principal: McpPrincipal,
  scope: ApiTokenScope,
  run: (args: A) => Promise<unknown>,
): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    if (!principal.scopes.includes(scope)) {
      return fail(`This token lacks the ${scope} scope. Create a token with it on the Checkpoint API Tokens page.`)
    }
    try {
      return ok(await run(args))
    } catch (err) {
      if (err instanceof HttpError) return fail(err.message)
      console.error('[mcp] tool error:', err)
      return fail((err as Error).message || 'Internal error')
    }
  }
}

// Statuses that mean "waiting on a human", used by list_pending_approvals.
const PENDING_STATUS = 'pending_approval'

export function buildServer(principal: McpPrincipal): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'Checkpoint manages reviewed database migrations. You can read the catalog, ' +
        'migrations and audit trail, and open new migrations for review. You cannot ' +
        'approve, reject, apply or schedule a migration — those are human actions ' +
        'taken in the Checkpoint UI. Report who needs to act instead.',
    },
  )
  const { user } = principal

  // --- catalog:read ---------------------------------------------------------

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: 'Projects visible to you, with environment and database counts.',
      inputSchema: { org: z.string().optional().describe('Only projects in this organization id') },
      annotations: { readOnlyHint: true },
    },
    tool(principal, 'catalog:read', async ({ org }: { org?: string }) =>
      (await listProjects(user.id, org ?? null)).map(toProject),
    ),
  )

  server.registerTool(
    'list_environments',
    {
      title: 'List environments',
      description:
        'Environments (dev/staging/production…) across your organizations, or within one project.',
      inputSchema: { project: z.string().optional().describe('Only environments in this project id') },
      annotations: { readOnlyHint: true },
    },
    tool(principal, 'catalog:read', async ({ project }: { project?: string }) =>
      project ? await listProjectEnvironments(user.id, project) : await listEnvironments(user.id),
    ),
  )

  server.registerTool(
    'list_databases',
    {
      title: 'List databases',
      description:
        'Managed databases you can see, with engine, environment and cached table count. ' +
        'Connection details never include passwords.',
      inputSchema: {
        project: z.string().optional().describe('Only databases in this project id'),
        org: z.string().optional().describe('Only databases in this organization id'),
      },
      annotations: { readOnlyHint: true },
    },
    tool(principal, 'catalog:read', async ({ project, org }: { project?: string; org?: string }) => {
      const rows = await listDatabases(user.id, { project: project ?? null, org: org ?? null })
      return Promise.all(rows.map(serializeDb))
    }),
  )

  server.registerTool(
    'get_database_schema',
    {
      title: 'Get database schema',
      description:
        "A database's last synced schema snapshot (tables and columns). Returns null if it has " +
        'never been synced. Reads the cached snapshot — it does not connect to the database.',
      inputSchema: { database_id: z.string().describe('Database id, from list_databases') },
      annotations: { readOnlyHint: true },
    },
    tool(principal, 'catalog:read', async ({ database_id }: { database_id: string }) =>
      getDatabaseSchema(user.id, database_id),
    ),
  )

  // --- migrations:read ------------------------------------------------------

  server.registerTool(
    'list_migrations',
    {
      title: 'List migrations',
      description: 'Migrations you can see, newest first, with their resolved governance.',
      inputSchema: {
        database: z.string().optional().describe('Only migrations for this database id'),
        org: z.string().optional().describe('Only migrations in this organization id'),
        status: z
          .enum(['draft', 'pending_approval', 'approved', 'rejected', 'running', 'applied', 'failed'])
          .optional()
          .describe('Only migrations in this status'),
      },
      annotations: { readOnlyHint: true },
    },
    tool(
      principal,
      'migrations:read',
      async ({ database, org, status }: { database?: string; org?: string; status?: string }) => {
        const rows = await listMigrations(user.id, {
          database: database ?? null,
          org: org ?? null,
          status: status ?? null,
        })
        return Promise.all(rows.map(fullMigration))
      },
    ),
  )

  server.registerTool(
    'get_migration',
    {
      title: 'Get migration',
      description:
        'Full detail for one migration: SQL statements, status, comments, event history, and the ' +
        'governance resolved for its project and environment (approvers, releasers, self_approvers, ' +
        'required_approvals) so you can report who still has to act. The "*" sentinel in a list ' +
        'means any organization member.',
      inputSchema: { migration_id: z.string().describe('Migration id, e.g. m_9f8e7d') },
      annotations: { readOnlyHint: true },
    },
    tool(principal, 'migrations:read', async ({ migration_id }: { migration_id: string }) =>
      fullMigration(await loadMig(user.id, migration_id)),
    ),
  )

  server.registerTool(
    'list_pending_approvals',
    {
      title: 'List migrations awaiting approval',
      description:
        'Migrations currently waiting on a human approval, with who is allowed to approve them. ' +
        'Use this to report what is blocked — you cannot approve them yourself.',
      inputSchema: { org: z.string().optional().describe('Only migrations in this organization id') },
      annotations: { readOnlyHint: true },
    },
    tool(principal, 'migrations:read', async ({ org }: { org?: string }) => {
      const rows = await listMigrations(user.id, { org: org ?? null, status: PENDING_STATUS })
      return Promise.all(rows.map(fullMigration))
    }),
  )

  // --- queries:read ---------------------------------------------------------

  server.registerTool(
    'list_saved_queries',
    {
      title: 'List saved queries',
      description: 'Saved read-only queries in your organizations, with their SQL and target database.',
      annotations: { readOnlyHint: true },
    },
    tool(principal, 'queries:read', async () => (await listSavedQueries(user.id)).map(toSq)),
  )

  server.registerTool(
    'run_saved_query',
    {
      title: 'Run a saved query',
      description:
        'Execute an existing saved query against its database read connection and return the rows. ' +
        'Only saved queries can be run — there is no tool for arbitrary SQL. The statement is ' +
        're-validated as read-only before connecting, and the run is recorded in the audit log.',
      inputSchema: { saved_query_id: z.string().describe('Saved query id, from list_saved_queries') },
      annotations: { readOnlyHint: true },
    },
    tool(principal, 'queries:read', async ({ saved_query_id }: { saved_query_id: string }) => {
      const sq = await loadSavedQuery(user.id, saved_query_id)
      const db = await loadDb(user.id, sq.database_id)
      // Defense in depth: a saved query could have been stored before a rule
      // tightened, so re-check read-only rather than trusting what was saved.
      assertReadOnly(db.engine, sq.sql_text)
      const conn = await getConnectionSecret(db.id, 'read')
      if (!conn) throw new HttpError(400, 'No read connection configured.')
      const result = await runReadQuery(db.engine, conn, sq.sql_text, await resolveTimeoutMs(db.org_id))
      const oneLine = sq.sql_text.replace(/\s+/g, ' ').trim()
      await writeAudit({
        actor: user,
        orgId: db.org_id,
        action: 'query.read',
        entityType: 'database',
        entityId: db.id,
        entityLabel: db.name,
        summary: `Ran saved query "${sq.name}" on ${db.name}${viaMcp(principal)} — ${oneLine.slice(0, 80)}${oneLine.length > 80 ? '…' : ''}`,
      })
      return result
    }),
  )

  // --- audit:read -----------------------------------------------------------

  server.registerTool(
    'list_audit_events',
    {
      title: 'List audit events',
      description:
        'Recent audit-log entries across your organizations, newest first — who did what, when.',
      inputSchema: { limit: z.number().int().min(1).max(500).optional().describe('Max events (default 100)') },
      annotations: { readOnlyHint: true },
    },
    tool(principal, 'audit:read', async ({ limit }: { limit?: number }) =>
      (await listAuditEvents(user.id, limit ?? 100)).map(toAuditEvent),
    ),
  )

  // --- migrations:write (the only mutating tools) ---------------------------

  server.registerTool(
    'create_migration',
    {
      title: 'Create a migration',
      description:
        'Open a migration against a database. With submit=false it is saved as a draft; with ' +
        'submit=true it goes to the project approvers for review. Statements are syntax-checked ' +
        'for the target engine and rejected if they do not parse. This never applies anything to ' +
        'the database — approval and release stay with a human in the Checkpoint UI.',
      inputSchema: {
        database_id: z.string().describe('Target database id, from list_databases'),
        title: z.string().describe('Short summary, e.g. "PROD-1234: add index on sessions.start_time"'),
        queries: z.array(z.string()).min(1).describe('Ordered SQL statements, one statement per entry'),
        description: z.string().nullable().optional().describe('Why this change is needed'),
        submit: z.boolean().optional().describe('true submits for approval; false (default) leaves a draft'),
        deploy_gated: z
          .boolean()
          .optional()
          .describe('Mark as a deployment migration — released only by an admin or deployer'),
        reviewers: z.array(z.string()).optional().describe('Reviewer emails to tag in the submit notification'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    tool(principal, 'migrations:write', async (args: {
      database_id: string
      title: string
      queries: string[]
      description?: string | null
      submit?: boolean
      deploy_gated?: boolean
      reviewers?: string[]
    }) => {
      if (!can(user.role, 'edit')) throw new HttpError(403, 'Your role does not permit this action.')
      // refuseAutoApprove: on a project requiring 0 approvals, submit would flip
      // the migration straight to approved with no human in the loop. That is an
      // approval, and no token or agent may approve — so refuse and send the
      // caller to the UI.
      return createMigration(user, args, {
        baseUrl: principal.baseUrl,
        via: viaMcp(principal),
        refuseAutoApprove: true,
      })
    }),
  )

  server.registerTool(
    'add_migration_comment',
    {
      title: 'Comment on a migration',
      description:
        'Append a comment to a migration — e.g. context for reviewers, or findings from your ' +
        'analysis. Comments are append-only and cannot be edited or deleted.',
      inputSchema: {
        migration_id: z.string().describe('Migration id'),
        body: z.string().min(1).describe('Comment text'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    tool(principal, 'migrations:write', async ({ migration_id, body }: { migration_id: string; body: string }) => {
      if (!can(user.role, 'edit')) throw new HttpError(403, 'Your role does not permit this action.')
      return addMigrationComment(user, migration_id, body)
    }),
  )

  return server
}

// Audit attribution: distinguishes agent traffic from a CI pipeline using the same
// token type (REST creates record ` via API token "…"`).
function viaMcp(principal: McpPrincipal): string {
  return ` via MCP (API token "${principal.tokenName}")`
}

// Serve one JSON-RPC request for an already-authenticated principal.
//
// Stateless: a fresh server + transport per request, JSON responses rather than
// SSE. Nothing is retained between calls, so there is no session map to grow and
// no cross-request state to leak between tokens.
export async function handleMcpRequest(req: Request, principal: McpPrincipal): Promise<Response> {
  // DNS-rebinding protection: a browser-originated request must come from an
  // allowed origin. Non-browser clients (Claude Code, curl) send no Origin.
  const origin = req.headers.get('origin')
  if (origin && !isAllowedOrigin(origin)) {
    return json({ error: 'Origin not allowed.' }, { status: 403 })
  }

  const server = buildServer(principal)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  try {
    await server.connect(transport)
    return await transport.handleRequest(req)
  } finally {
    await server.close().catch((err: Error) => console.error('[mcp] close failed:', err.message))
  }
}

// Streamable HTTP also defines GET (server-initiated SSE) and DELETE (end
// session). This deployment is stateless request/response, so both are refused
// explicitly — clearer for a client than a bare 404.
export function mcpMethodNotAllowed(): Response {
  return json(
    { error: 'The Checkpoint MCP endpoint is stateless: use POST /api/mcp. SSE streams and sessions are not supported.' },
    { status: 405, headers: { allow: 'POST' } },
  )
}

export function registerMcp(router: Router) {
  router.post('/api/mcp', async (ctx: Ctx) => {
    // The endpoint is for programmatic agents, so it is token-only: a session
    // cookie is not accepted. This keeps the principal (and therefore the scope
    // set) unambiguous, and means a browser that is merely logged in cannot be
    // steered into driving the tools cross-origin.
    if (!ctx.apiToken || !ctx.user) {
      return json(
        { error: 'The MCP endpoint requires an API token: Authorization: Bearer chk_… (create one under API Tokens).' },
        { status: 401 },
      )
    }
    return handleMcpRequest(ctx.req, {
      user: ctx.user,
      scopes: ctx.apiToken.scopes,
      tokenName: ctx.apiToken.name,
      baseUrl: env.appBaseUrl || ctx.url.origin,
    })
  })

  router.get('/api/mcp', async () => mcpMethodNotAllowed())
  router.delete('/api/mcp', async () => mcpMethodNotAllowed())
}
