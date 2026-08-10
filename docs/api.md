# Checkpoint REST API

Programmatic access to Checkpoint using personal access tokens — create and
read migrations from CI pipelines, scripts, or tools. Everything a token does
still flows through Checkpoint's normal review/approval process; approving and
applying migrations is deliberately **not** available via the API, nor over
MCP.

> Looking to connect an AI agent instead? Checkpoint also exposes an MCP server
> at `POST /api/mcp`, using these same tokens and scopes — see
> [`docs/mcp.md`](mcp.md).

## Authentication

Create a token in the app under **API Tokens** (any signed-in user). The full
secret is shown exactly once at creation — Checkpoint stores only its SHA-256
hash. Send it on every request:

```
Authorization: Bearer chk_<your-token>
```

A token acts as the user who created it: role, organization membership, and
project governance checks apply exactly as they do in the UI. A viewer's token
cannot create migrations, and **no token can approve or apply one** — that holds
whatever scopes the token has and whatever role its owner has. It is enforced
three times over: the route allowlist below, a refusal at the point of action
for any token principal, and the absence of any MCP tool for those verbs.

This extends to the one path that used to be an exception. A project can be
configured to require **0 approvals**, which makes a submit approve the
migration outright. A token cannot take that path: `POST /api/migrations` with
`submit: true` against such a project is rejected with `403`, and you are
directed to submit from the UI. Create the migration as a draft
(`submit: false`) and submit it there. Session users in the browser are
unaffected.

Tokens are prefixed `chk_` so secret scanners (gitleaks, trufflehog, GitHub
secret scanning custom patterns) can match them: `chk_[A-Za-z0-9_-]{43}`.
If a token leaks, revoke it on the API Tokens page — revocation is immediate.

### Scopes

Chosen at creation; a token only ever holds the scopes you give it.

| Scope | Grants |
| --- | --- |
| `migrations:read` | List migrations and fetch a migration's detail (also implies `catalog:read`) |
| `migrations:write` | Create a migration (optionally submitting it for review) |
| `catalog:read` | Read projects, environments, databases and schemas (MCP only) |
| `queries:read` | List and run saved queries (MCP only) |
| `audit:read` | Read the audit log (MCP only) |

The last three scopes have no REST endpoints today — they exist to scope MCP
tools ([`docs/mcp.md`](mcp.md)). `queries:read` and `audit:read` are never
implied by another scope.

Requests to any endpoint outside the tables below — or without the required
scope — are rejected with `403`. Token management (`/api/tokens`) is
session-only and can never be driven by a token.

### Errors

Errors are JSON: `{ "error": "<message>" }`.

| Status | Meaning |
| --- | --- |
| 400 | Invalid body (missing fields, bad SQL syntax for the target engine) |
| 401 | Missing/invalid/expired/revoked token |
| 403 | Endpoint not token-enabled, missing scope, or role/org check failed |
| 404 | Unknown resource (or not visible to your organizations) |
| 429 | Too many failed authentication attempts — back off and retry |

## Endpoints

### List migrations

```
GET /api/migrations                 scope: migrations:read
GET /api/migrations?database=<id>   filter by database
GET /api/migrations?org=<id>        filter by organization
```

Returns an array of migration objects (see shape below), newest first, scoped
to organizations the token's owner belongs to.

### Get a migration

```
GET /api/migrations/:id             scope: migrations:read
```

### Create a migration

```
POST /api/migrations                scope: migrations:write
Content-Type: application/json
```

| Field | Type | Notes |
| --- | --- | --- |
| `database_id` | string | required — target database |
| `title` | string | required |
| `description` | string \| null | optional |
| `queries` | string[] | required — ordered SQL statements, one per entry |
| `submit` | boolean | `false` → draft; `true` → submitted for approval. Rejected with `403` if the project requires 0 approvals (that would auto-approve — see Authentication above) |
| `deploy_gated` | boolean | optional — mark as a deployment migration (applied only by an admin/deployer) |
| `reviewers` | string[] | optional — reviewer emails, tagged in the submit notification |

Statements are syntax-checked for the target database's engine; the first
invalid statement rejects the request with `400`.

Example — open a migration for review from CI:

```bash
curl -sS https://checkpoint.example.com/api/migrations \
  -H "Authorization: Bearer $CHECKPOINT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "database_id": "db_1a2b3c",
    "title": "PROD-1234: add index on sessions.start_time",
    "description": "Ships with the booking-search release.",
    "queries": ["CREATE INDEX idx_sessions_start_time ON sessions (start_time)"],
    "submit": true,
    "reviewers": ["dba@example.com"]
  }'
```

The response is the created migration:

```jsonc
{
  "id": "m_9f8e7d",
  "database_id": "db_1a2b3c",
  "database_name": "core-production",
  "engine": "mysql",
  "title": "PROD-1234: add index on sessions.start_time",
  "status": "pending_approval",   // draft | pending_approval | approved | …
  "author_email": "you@example.com",
  "queries": [{ "id": "q_1", "order": 1, "sql": "CREATE INDEX …" }],
  "reviewers": ["dba@example.com"],
  "events": [{ "at": "…", "actor_email": "you@example.com", "action": "created", "note": null }]
  // … approvers, releasers, self_approvers, comments, timestamps
}
```

Every migration also carries the governance resolved for its project and
environment — `approvers`, `releasers`, `self_approvers` and
`required_approvals` — so a pipeline can tell who is allowed to act on it. All
three lists are emails, and the `*` sentinel means "any org member".
`self_approvers` are the users allowed to approve their own migrations (it
replaces the former `allow_self_approval` boolean; projects that had it enabled
read as `["*"]`).

From here the migration follows the normal lifecycle in the app: reviewers are
notified, an admin approves, and a releaser applies it. Poll
`GET /api/migrations/:id` if your pipeline wants to wait on the outcome
(`status` becomes `applied`, `rejected`, or `failed`).

## Token lifecycle

- **Expiry** — optional (30/60/90 days in the UI; the API accepts 1–365 or
  none). Expired tokens fail with `401`.
- **Revocation** — immediate, from the API Tokens page. Revoked tokens keep an
  audit-trail row but never authenticate again.
- **Auditing** — token creation, revocation, and every token-authenticated
  migration create is recorded in the audit log, labeled with the token name.
  MCP-originated writes are labeled `via MCP (API token "…")` so agent traffic
  is distinguishable from CI.
- **Last used** — shown on the API Tokens page to help spot stale tokens.

## Versioning & compatibility

Checkpoint follows [semver](https://semver.org). Within a major version,
endpoints and response fields documented here are additive-only — fields may be
added, never removed or repurposed. Breaking API changes are called out in
[`CHANGELOG.md`](../CHANGELOG.md) and ship with a major-version bump.
