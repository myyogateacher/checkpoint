# Checkpoint — Feature & Backend Specification

This document is the source of truth for **planning the backend**. The frontend
is built and runs against mocks; everything below describes the behavior the
real backend must reproduce. Types referenced here live in
[`../src/types.ts`](../src/types.ts); the client call sites live in
[`../src/services/api.ts`](../src/services/api.ts).

- Frontend ⇄ backend contract: JSON over HTTP.
- The client sends `credentials: 'include'` (cookie session) and a
  `Content-Type: application/json` body for writes.
- On error, respond with a non-2xx status and a body `{ "error": "message" }`.
- `204 No Content` is treated as `null` by the client.

---

## 1. Glossary & hierarchy

```
Project ── Environment ── Database ── { read_connection, write_connection }
                                   └─ schema snapshot (cached, refreshed by "pull")
Migration ── targets one Database ── { queries[], reviewers[], comments[], events[] }
```

- **Project** — top-level grouping (e.g. "Core Platform"). Has tags.
- **Environment** — `production` / `staging` / `development` within a project.
- **Database** — a single managed DB (`postgres` | `mysql` | `clickhouse`) in one
  environment, with separate **read** and **write** connections and tags.
- **Migration** — a reviewable set of ordered SQL statements applied to one
  database's write connection.

---

## 2. Roles & RBAC

Roles: `admin`, `editor`, `viewer`. The client gates UI via
`can(role, capability)` ([`src/lib/format.ts`](../src/lib/format.ts)); the
**backend must enforce the same matrix server-side** (UI gating is not security).

| Capability                                   | viewer | editor | admin |
| -------------------------------------------- | :----: | :----: | :---: |
| Browse projects/schema, run read queries     |   ✓    |   ✓    |   ✓   |
| Pull schema                                   |        |   ✓    |   ✓   |
| Create / submit migration                     |        |   ✓    |   ✓   |
| Add/remove reviewers, comment                 |        |   ✓    |   ✓   |
| Approve / reject migration                    |        |        |   ✓   |
| Apply migration                               |        |        |   ✓   |
| Create projects/databases, edit read conn     |        |   ✓    |   ✓   |
| Edit write connection                         |        |        |   ✓   |
| Manage users, edit settings                   |        |        |   ✓   |

> Capability mapping today: `edit` → editor+admin, `approve` & `manage_users` →
> admin only. Revisit whether a dedicated "reviewer/approver" tier is needed
> (see Open Questions).

---

## 3. Authentication

- **Google OAuth only.** Public surface: none yet (the whole control plane
  requires sign-in). The login screen links to `GET /api/auth/google`.
- Flow: `GET /api/auth/google?returnTo=…` → Google consent →
  `GET /api/auth/google/callback` → set session cookie → redirect to `returnTo`.
- **Provisioning:** only known users may sign in. A user must be invited
  (allowlist) before first login. Reject with a clear reason
  (`account_not_provisioned`, `banned`).
- `GET /api/auth/me` → `SessionState { authenticated, user }`.
- `POST /api/auth/logout` → clears session (`204`).
- Session: signed, httpOnly cookie. On first successful login, record
  `last_login_at`.

> The mock uses `mockSignIn()` / localStorage — that is dev-only and goes away
> when `USE_MOCKS=false`.

---

## 4. Data model (suggested metadata store)

Checkpoint keeps its own metadata DB (see `APP_DATABASE_URL`,
`docker-compose.example.yml`). Managed databases are **external** and only
reached via their stored connections. Suggested tables (Postgres):

### users
`id, email (unique), name, picture, role (admin|editor|viewer), is_banned,
is_allowlisted, last_login_at, created_at`

### projects
`id, name, description, tags (text[]), created_at`

### environments
`id, project_id → projects, name, color, created_at`
(UI `color` is a display accent key: `rose|amber|emerald`.)

### databases
`id, project_id, environment_id, name, engine (postgres|mysql|clickhouse),
tags (text[]), last_synced_at, created_at`

### connections
`id, database_id, mode (read|write), host, port, username,
database, ssl (bool), password_encrypted, created_at, updated_at`
One read + one write row per database. **Password stored encrypted at rest**;
never returned to the client (only `has_password`).

### schema_snapshots
`database_id, synced_at, payload (jsonb)` — cached introspection result
(`SchemaSnapshot`: tables → columns/indexes/row estimates). Refreshed by "pull".

### migrations
`id, database_id, title, description, status, author_email,
created_at, approved_by, approved_at, applied_at`
- `status`: `draft | pending_approval | approved | rejected | running | applied | failed`

### migration_queries
`id, migration_id, "order", sql`

### migration_reviewers
`migration_id, reviewer_email` (set semantics)

### migration_comments
`id, migration_id, author_email, body, created_at`

### migration_events
`id, migration_id, at, actor_email, action, note` — the per-migration timeline
(`created|submitted|approved|rejected|applied|failed`).

### audit_logs
`id, actor_email, actor_name, action, entity_type, entity_id, entity_label,
summary, created_at` — system-wide (see §11).

### settings
Single row (or key/value): email (SMTP) + Slack config (see §10).

---

## 5. Projects, environments, databases

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/api/projects` | any | list (with `environment_count`, `database_count`) |
| GET | `/api/projects/:id` | any | single |
| POST | `/api/projects` | edit | create (name, description, tags) |
| GET | `/api/projects/:id/environments` | any | environments of a project |
| GET | `/api/environments` | any | all environments (used by Query Studio & pickers) |
| GET | `/api/databases?project=:id` | any | list; `project` optional (all if absent) |
| GET | `/api/databases/:id` | any | single (includes both connections, sans secrets) |
| POST | `/api/databases` | edit | create — body `DatabaseInput` (project, env, name, engine, tags, read+write connection inputs incl. plaintext password to store encrypted) |

`Connection` returned to client carries `has_password: boolean`, never the secret.

---

## 6. Schema browsing & "pull schema"

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/api/databases/:id/schema` | any | latest cached `SchemaSnapshot` (or 404 if never synced) |
| POST | `/api/databases/:id/schema/sync` | edit | connect via **read** connection, introspect, persist snapshot, update `last_synced_at`, return it |

Introspection must produce, per table: `schema`, `name`, `estimated_rows`,
`columns[] {name, data_type, nullable, default, is_primary_key}`,
`indexes[] {name, columns[], unique}`. Engine-specific:
- Postgres: `information_schema` / `pg_catalog`, `reltuples` for estimates.
- MySQL: `information_schema.{TABLES,COLUMNS,STATISTICS}`.
- ClickHouse: `system.tables` / `system.columns`; "ORDER BY" surfaced as a
  pseudo-index. Writes an audit log entry (`schema.sync`).

---

## 7. Read panel / Query Studio

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| POST | `/api/databases/:id/query` | any | body `{ sql }`; runs on the **read** connection |

**Read-only enforcement is a backend security requirement**, not just a UI
nicety. The client pre-checks that statements start with
`select` / `show` / `with` / `explain`, but the server must guarantee it:
- Prefer connecting as a least-privilege read-only DB user (the read connection
  should already be read-only).
- Additionally reject non-read statements and multiple statements server-side.
- Apply a row cap and statement timeout.

Response `QueryResult { columns[], rows[], row_count, duration_ms }`.
Writes an audit entry (`query.read`). Consider redaction/limits for sensitive
columns (Open Questions).

---

## 8. Migrations

### Lifecycle (state machine)

```
draft ──submit──► pending_approval ──approve──► approved ──apply──► applied
  ▲                      │                                            │
  └──────(author edits)  └──reject──► rejected                        └─(on error)─► failed
```

- A migration has **≥1 ordered SQL statement**.
- `submit`: author/editor moves `draft → pending_approval`.
- `approve` / `reject`: **admin** only; sets `approved_by`/`approved_at` or
  `rejected`. `reject` carries a note shared with the author.
- `apply`: **admin** only; allowed from `approved`. Runs all statements **in
  order** against the **write** connection, ideally transactionally where the
  engine supports it; sets `applied_at`. On failure → `failed` with the error
  recorded in the event. (Note: some statements like Postgres
  `CREATE INDEX CONCURRENTLY` can't run in a transaction — plan per-statement
  handling and partial-failure semantics.)
- Every transition appends a `migration_events` row and an `audit_logs` row.

### Endpoints

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/api/migrations?database=:id` | any | list (all, or by database) |
| GET | `/api/projects/:id/migrations` | any | all migrations across a project's databases |
| GET | `/api/migrations/:id` | any | full migration incl. queries, reviewers, comments, events |
| POST | `/api/migrations` | edit | create — body `{ database_id, title, description, queries: string[], submit: boolean }` (`submit:true` goes straight to `pending_approval`) |
| POST | `/api/migrations/:id/submit` | edit/author | transition |
| POST | `/api/migrations/:id/approve` | approve(admin) | optional `{ note }` |
| POST | `/api/migrations/:id/reject` | approve(admin) | `{ note }` |
| POST | `/api/migrations/:id/apply` | approve(admin) | executes against write conn |
| PUT | `/api/migrations/:id/reviewers` | edit | body `{ reviewers: string[] }` (full set; emails of existing users, not author) |
| POST | `/api/migrations/:id/comments` | edit | body `{ body }`; returns updated migration |

> The four transition routes are `/:id/{submit,approve,reject,apply}` to mirror
> the client's `transitionMigration(id, action)`.

---

## 9. Users

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/api/users` | manage_users | list (`is_self` flag per row) |
| POST | `/api/users` | manage_users | invite `{ email, role }` → allowlists the user |
| PATCH | `/api/users/:id/role` | manage_users | `{ role }` |
| DELETE | `/api/users/:id` | manage_users | remove (cannot remove self) |

(The legacy ban flag exists in the data model; no UI yet.)

---

## 10. Settings & notifications

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/api/settings` | manage_users | returns `AppSettings` (email password as `has_password`) |
| PUT | `/api/settings` | manage_users | upsert; SMTP password write-only (blank = keep) |

`AppSettings`:
- **email**: `enabled, smtp_host, smtp_port, from_address, username, has_password`
- **slack**: `enabled, webhook_url, channel, notify_on_submit, notify_on_approve, notify_on_apply`

**Notification triggers (backend to implement):** on the corresponding migration
transitions, if enabled, send email (to author + reviewers + admins, TBD) and/or
post to the Slack incoming webhook. These are configured here but **not yet
wired to fire** — that's net-new backend work. Settings is **tabbed** (Email /
Slack) and designed to grow more sections.

---

## 11. Audit log

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/api/audit-logs` | any (admin?) | newest-first system-wide log |

`AuditLogEntry { id, actor_email, actor_name, action, entity_type, entity_id,
entity_label, summary, created_at }`.

- `entity_id` lets the UI deep-link migration entries to `/migrations/:id`.
- The client derives a **category** from the `action` key (do not add a column):
  - `migration.*` → *Migration changes* (created/submitted/approved/rejected/applied)
  - `schema.*`, `query.*` → *Manual actions* (e.g. `schema.sync`, `query.read`)
  - everything else (`user.*`, `role.*`, `connection.*`, …) → *System changes*
- **Keep the `entity.verb` naming convention** (e.g. `migration.apply`,
  `connection.update`) so categorization keeps working with no client change.
- The log should be append-only / immutable.

Every mutating action across the system should write an audit entry.

---

## 12. Security checklist for the backend

- Enforce RBAC server-side on every route (don't trust the client).
- Read panel: guarantee read-only at the DB-user level **and** reject
  write/multi statements; apply timeouts + row caps.
- Store connection & SMTP secrets **encrypted at rest**; never return them
  (only `has_password`). Accept write-only updates (blank = unchanged).
- Apply migrations through the **write** connection only; consider a dry-run /
  EXPLAIN preview and per-statement error capture.
- Session cookies: signed, httpOnly, SameSite; CSRF protection for state-changing
  routes.
- Rate-limit query execution and OAuth callbacks.

---

## 13. Deployment

- Multi-stage `Dockerfile` (Bun build → Bun runtime) builds the SPA into `dist/`
  and serves it from the same Bun server that hosts `/api`.
- `docker-compose.example.yml` runs the app + a Postgres metadata store
  (`meta-db`). Managed databases are external and reached over the network via
  stored connections.
- Env: `PORT, SESSION_SECRET, GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI,
  APP_DATABASE_URL` (+ encryption key for secrets — to add).

---

## 14. Open questions for backend planning

1. **Approver tier** — should approve/apply be a distinct role, or split
   approve (review) from apply (execute)? Currently both are admin-only.
2. **Apply semantics** — transaction wrapping per engine; how to handle
   non-transactional statements (e.g. `CREATE INDEX CONCURRENTLY`), partial
   failure, and `running`/`failed` states. Background job vs. synchronous?
3. **Reviewer enforcement** — are reviewers advisory, or must a reviewer approve
   before an admin can apply? Required-reviewer count?
4. **Read-query safety** — row/time caps, column redaction for PII, per-role
   query allowlists?
5. **Notification recipients** — who gets email on each event (author,
   reviewers, all admins)? Slack message format/templates.
6. **Secrets** — KMS vs. app-level encryption key; rotation.
7. **Schema diffing** — should "pull" diff against the last snapshot and surface
   drift, or just replace?
8. **Multi-statement migrations** — max size, linting/validation before submit,
   dependency on target engine dialect.
