# Checkpoint MCP server

Checkpoint speaks [MCP](https://modelcontextprotocol.io) (Model Context
Protocol), so an AI agent can read your migration catalog and open migrations
for review — without being able to approve or apply anything.

```
POST https://checkpoint.azure-services.myyogateacher.com/api/mcp
```

The transport is **Streamable HTTP**, stateless: one JSON-RPC request, one JSON
response. There are no sessions and no SSE streams (`GET` and `DELETE` on the
endpoint answer `405`).

## Authentication

MCP uses the same personal access tokens as the REST API. Create one under
**API Tokens** in the app, pick the scopes you want the agent to have, and send
it as a Bearer token:

```
Authorization: Bearer chk_<your-token>
```

The endpoint is **token-only** — a browser session cookie is not accepted, so
the calling principal and its scope set are never ambiguous.

### Connecting from Claude Code

```bash
claude mcp add --transport http checkpoint \
  https://checkpoint.azure-services.myyogateacher.com/api/mcp \
  --header "Authorization: Bearer chk_..."
```

> **claude.ai remote connectors are not supported yet.** Connectors added in the
> claude.ai UI require OAuth 2.1 with dynamic client registration; Checkpoint
> authenticates with static tokens only. Use Claude Code, or any MCP client that
> lets you set a static `Authorization` header.

## Tools

| Tool | Scope | What it does |
| --- | --- | --- |
| `list_projects` | `catalog:read` | Projects you can see, with environment/database counts |
| `list_environments` | `catalog:read` | Environments across your orgs, or within one project |
| `list_databases` | `catalog:read` | Managed databases (engine, environment, table count) |
| `get_database_schema` | `catalog:read` | Last synced schema snapshot for a database |
| `list_migrations` | `migrations:read` | Migrations, filterable by database, org, or status |
| `get_migration` | `migrations:read` | Full migration detail: SQL, comments, events, governance |
| `list_pending_approvals` | `migrations:read` | Migrations waiting on a human approval |
| `list_saved_queries` | `queries:read` | Saved read-only queries and their SQL |
| `run_saved_query` | `queries:read` | Run an existing saved query and return rows |
| `list_audit_events` | `audit:read` | Recent audit-log entries, newest first |
| `create_migration` | `migrations:write` | Open a migration as a draft, or submit it for review |
| `add_migration_comment` | `migrations:write` | Append a comment to a migration |

Only the last two mutate anything, and neither puts SQL on a database.

`get_migration` returns the governance resolved for the migration's project and
environment — `approvers`, `releasers`, `self_approvers` and
`required_approvals` — so an agent can tell you *who needs to act* on a blocked
migration. The `*` sentinel in any of those lists means "any org member".

### Scopes

Scopes are chosen per token and enforced per tool call; a call without the
required scope comes back as a tool error naming the missing scope.

| Scope | Grants |
| --- | --- |
| `migrations:read` | Read migrations (**also implies `catalog:read`** — migration ids are meaningless without the projects and databases they point at, and the catalog exposes no secrets) |
| `migrations:write` | Create migrations and comment on them |
| `catalog:read` | Read projects, environments, databases, schemas |
| `queries:read` | List and run saved queries |
| `audit:read` | Read the audit log |

`queries:read` and `audit:read` are **never** implied by another scope — reading
table data or the organization's audit trail is always an explicit grant.

Connection passwords are write-only in Checkpoint and are never returned by any
tool; databases report only a `has_password` boolean.

## What an agent cannot do

There is no tool for any of these, and adding one would not be enough to make
them work:

| Verb | Why it is excluded |
| --- | --- |
| `approve` / `reject` | Approval is the entire point of Checkpoint's review gate. A migration is approved by a human who is an authorized approver, in a browser session. |
| `apply` | Applying runs the SQL against a real database. That decision belongs to a releaser at a moment they choose. |
| `schedule` / `cancel-schedule` | Scheduling is a deferred apply; same authority, same reasoning. |
| `submit` (standalone) | Submitting an existing migration is a review-flow action. Agents may create a migration already submitted — that starts review, it does not shortcut it. |
| `set_reviewers` | Who reviews a change is a human call about accountability. |
| arbitrary SQL | `run_saved_query` runs queries a person already wrote, reviewed and saved. There is no free-form query tool. |

This is enforced in depth, not just by leaving tools out:

1. **No tools** — the MCP server registers none of these verbs.
2. **Route allowlist** — Bearer auth is deny-by-default. Only the routes in
   `TOKEN_ROUTES` (`server/lib/apiTokens.ts`) accept a token at all; the
   approve/reject/apply/schedule routes are session-only and a token request to
   them is rejected with `403` before the handler runs. A regression test
   asserts no governance verb ever appears in that table.
3. **Point-of-action refusal** — `assertNotTokenPrincipal`
   (`server/modules/migrations.ts`) throws `403` if a token principal reaches a
   governance verb by any path, whatever its scopes and whatever the owner's
   role. It guards every review-flow route on an existing migration — `submit`,
   `approve`, `reject`, `apply`, `schedule`, `cancel-schedule` and
   `PUT .../reviewers` — and a test asserts that list stays complete. This is the
   layer that holds even if 1 or 2 are broken by a future change.
4. **No 0-approval shortcut** — a project can be configured to require 0
   approvals, which makes a submit approve the migration outright. Token and MCP
   callers are refused that path (`create_migration` with `submit: true` returns
   an error naming it) and told to submit from the UI; only a human session can
   take it.

Beyond governance, an agent is still bound by everything else: a token acts as
the user who created it, so role (`viewer` cannot create migrations),
organization membership, and per-project rules apply exactly as in the UI.

## Auditing

Every MCP mutation is written to the audit log attributed as
`via MCP (API token "<name>")`, distinct from the `via API token "<name>"` that
REST/CI writes use — so agent traffic is always separable from pipeline traffic.
`run_saved_query` records a `query.read` entry naming the query and database.

## Example exchange

```bash
curl -sS https://checkpoint.azure-services.myyogateacher.com/api/mcp \
  -H "Authorization: Bearer $CHECKPOINT_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
        "name":"list_pending_approvals","arguments":{}}}'
```

Tool results are JSON encoded in a text content block — the same objects the
REST API returns.

## See also

- [`docs/api.md`](api.md) — the REST API, same tokens and same scopes.
