# Checkpoint REST API

Programmatic access to Checkpoint using personal access tokens — create and
read migrations from CI pipelines, scripts, or tools. Everything a token does
still flows through Checkpoint's normal review/approval process; approving and
applying migrations is deliberately **not** available via the API.

## Authentication

Create a token in the app under **API Tokens** (any signed-in user). The full
secret is shown exactly once at creation — Checkpoint stores only its SHA-256
hash. Send it on every request:

```
Authorization: Bearer chk_<your-token>
```

A token acts as the user who created it: role, organization membership, and
project governance checks apply exactly as they do in the UI. A viewer's token
cannot create migrations, and no token can approve or apply one. (One nuance,
identical to the UI: a project configured to require **0 approvals**
auto-approves a migration on submit — governance, not the token, grants that.)

Tokens are prefixed `chk_` so secret scanners (gitleaks, trufflehog, GitHub
secret scanning custom patterns) can match them: `chk_[A-Za-z0-9_-]{43}`.
If a token leaks, revoke it on the API Tokens page — revocation is immediate.

### Scopes

Chosen at creation; a token only ever holds the scopes you give it.

| Scope | Grants |
| --- | --- |
| `migrations:read` | List migrations and fetch a migration's detail |
| `migrations:write` | Create a migration (optionally submitting it for review) |

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
| `submit` | boolean | `false` → draft; `true` → submitted for approval (auto-approved if the project requires 0 approvals) |
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
  // … approvers, releasers, comments, timestamps
}
```

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
- **Last used** — shown on the API Tokens page to help spot stale tokens.

## Versioning & compatibility

Checkpoint follows [semver](https://semver.org). Within a major version,
endpoints and response fields documented here are additive-only — fields may be
added, never removed or repurposed. Breaking API changes are called out in
[`CHANGELOG.md`](../CHANGELOG.md) and ship with a major-version bump.
