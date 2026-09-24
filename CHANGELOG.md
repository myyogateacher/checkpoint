# Changelog

All notable changes to Checkpoint are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Redshift reloads are in the audit log** — a DMS reload triggered by a migration
  now writes an audit entry as well as a migration-timeline event, for all four
  outcomes (needed, queued, sent, failed). Until now they were recorded only in
  `migration_events` and Slack, so the audit log showed nothing for them and
  searching it for "redshift" came back empty even on a day a reload had run. The
  actions are named `migration.redshift_reload_*`, so they file under *Migration
  changes* next to the apply that caused them.
- **Server-enforced migration validation** — enabled, organization-specific
  validation rules for PostgreSQL, MySQL, and ClickHouse are now checked when a
  migration is created or edited. This applies equally to browser REST requests
  and MCP/API-token migration writes, so rules can no longer be bypassed outside
  the form. MySQL online-DDL and charset checks remain configurable per
  organization; ClickHouse `ON CLUSTER` checking is opt-in for distributed
  deployments.

## [1.5.0] - 2026-09-18

### Added

- **Forked from link** — a migration created with the Fork button now records its
  source (`migrations.forked_from_id`, schema version 9) and the migration page
  shows a "Forked from" row in Details linking back to it. `POST /api/migrations`
  accepts an optional `forked_from_id`. Forks created before this release have no
  link, since the relationship was not stored.
- **Migration and audit-log pagination** — server-side pagination keeps long
  migration lists and audit histories responsive, with navigation controls that
  preserve the current filters.
- **ClickHouse live access** — ClickHouse databases can now validate read and
  write connections, pull schema metadata from `system.tables` and
  `system.columns`, run read-only queries, and apply migrations. The driver uses
  the ClickHouse HTTP interface and scopes schema discovery to the configured
  database.

### Changed

- **Migrations can be edited while in review** — `PATCH /api/migrations/:id` and
  the Edit button now accept a migration that is `pending_approval` or `approved`,
  not just a draft. Saving such an edit resets the approval: the migration returns
  to `draft`, the approvals recorded so far stop counting toward the required
  threshold, and any pending schedule is cancelled, so the author re-submits and
  approvers review the new statements. Applied and rejected migrations are still
  immutable (409).
- **ClickHouse validation feedback** — connection failures from the Add database
  and Edit connection dialogs are now shown in full, wrapping beside the
  validation action so hosts and credentials can be corrected without losing the
  useful error detail.

## [1.4.0] - 2026-09-15

### Added

- **Edit database name and tags** — a pencil on each database card on the project
  page opens a dialog to rename the database or change its tags (`PATCH
  /api/databases/:id`, editors and admins). Engine, environment and connections
  stay as they are. Each change is recorded as a `database.update` audit event.
- **Fork a migration** — a Fork button on the migration page opens the new-migration
  form pre-filled with the title, description, statements, deployment flag and
  reviewers, with the target database left for you to pick. Useful for promoting a
  change applied on one environment to the next.
- **Edit a draft migration** (`PATCH /api/migrations/:id`) — a draft's title,
  description, deploy-gated flag and full statement list can be revised in
  place instead of being recreated. Drafts only: any other status is refused
  with 409, since a migration in review holds the statements its approvers
  vouched for. Open to the migration's author or anyone with the `edit`
  capability, and to API tokens with `migrations:write`. The statement list is
  replaced transactionally and validated exactly as create validates it
  (including the multi-statement rejection); the edit is recorded as an
  `edited` migration event and a `migration.edit` audit entry.
- **Redshift replica protection** — some MySQL DDL never reaches a Redshift target
  over DMS (MODIFY/CHANGE COLUMN, NULL/NOT NULL, a default change, a character set
  or collation change, and editing an ENUM/SET definition). DMS suspends that one
  table and leaves the task `running`, so nothing alarms while the warehouse goes
  stale. Three parts:
  - The migration form shows an amber notice on any statement that will do this,
    naming the table and the reason, only on the database that feeds the replica.
  - After a successful apply Checkpoint calls DMS `ReloadTables` for those tables,
    records a `redshift reload` event on the migration and posts to Slack. It can
    never fail an already-applied migration.
  - An optional watch (`DMS_WATCH_ENABLED`) polls `DescribeTableStatistics` every
    five minutes for tables that broke without a Checkpoint migration behind them.
    First failure is reloaded. A table still broken after the reload's grace window
    is a Redshift schema mismatch: its target table is dropped and reloaded, which
    recreates it with the current schema and data. Still broken after that escalates
    and stops acting. Recovery history lives in the new `dms_table_recovery` table so
    the escalation survives a restart.

  The drop is gated three ways — `DMS_ALLOW_DROP` must be on, a Redshift connection
  must be configured (`REDSHIFT_HOST` and friends), and the table must still exist at
  the MySQL source — and refuses any name that is not a plain identifier. With the
  gates closed it posts the statement to Slack for a human instead. The Redshift
  connection lives in the environment rather than as a managed database, since the
  recovery runs on a cron with no user session behind it. DMS names tables by their
  MySQL schema; set `REDSHIFT_SCHEMA` when the task lands them in a differently named
  schema on the target, or the drop aims at a schema that is not there.

  Configured with `DMS_TASK_ARN` and `DMS_SOURCE_SCHEMA`; `DMS_AUTO_RELOAD=false`
  downgrades the migration hook to warn-and-notify.

- **PostgreSQL driver** (`server/lib/drivers/postgres.ts`) — connect, introspect,
  read-only query and migration apply over the Postgres wire protocol, using `pg`.
  Registered for Redshift only, which is what the replica recovery needs in order to
  drop a stale target table; the Postgres family can be added to the registry when
  live access is wanted there. Redshift has no indexes, so introspection reports
  none and leaves estimated row counts at 0 rather than guessing.

## [1.3.0] - 2026-08-10

### Added

- **MCP server** (`POST /api/mcp`) — connect an AI agent to Checkpoint over
  Streamable HTTP (stateless; no sessions or SSE), authenticated with the same
  `chk_` personal access tokens. Twelve tools: read the catalog (projects,
  environments, databases, schemas), read migrations (including the resolved
  approvers/releasers/required_approvals, so an agent can report who must act),
  list pending approvals, list and run saved queries, read the audit log, plus
  exactly two mutating tools — create a migration and comment on one.
  **No tool exists for approve, reject, apply, schedule, standalone submit,
  set-reviewers, or arbitrary SQL**, and that is enforced in depth rather than
  by omission (route allowlist + a point-of-action refusal for any token
  principal). MCP writes are audit-logged as `via MCP (API token "…")`.
  Claude Code and other static-token clients are supported; claude.ai remote
  connectors (which require OAuth 2.1) are not. See `docs/mcp.md`.
- **Three new token scopes** — `catalog:read`, `queries:read` and `audit:read`,
  selectable on the API Tokens page, scoping the MCP read tools.
  `migrations:read` implies `catalog:read` (migration ids need the catalog to
  resolve, and the catalog holds no secrets); `queries:read` and `audit:read`
  are never implied.
- **API access via personal access tokens** — create and read migrations
  programmatically (`Authorization: Bearer chk_…`). Tokens are scoped
  (`migrations:read` / `migrations:write`), act as their owner under the same
  RBAC, and can never approve or apply a migration. Only the token's SHA-256
  hash is stored; failed attempts are rate-limited; creation, revocation, and
  token-authenticated writes are audit-logged. See `docs/api.md`.
- **API Tokens page** — self-service token management for every user: create
  with scopes + optional expiry (30/60/90 days or none), one-time secret
  reveal with copy, revoke with confirmation, last-used tracking.
- **Per-user self-approval** — self-approval is now granted to specific people
  instead of being all-or-nothing. Project settings (and per-environment
  overrides) carry a `self_approvers` email list; the `*` sentinel ("All Users")
  means everyone may approve their own migrations. Authors without a grant no
  longer see an Approve button. Self-approvers still have to be authorized
  approvers — the grant only lifts the "can't approve your own" restriction.
- **"All Users" for approvers** — the project approvers list accepts the same
  `*` sentinel already supported for releasers, so any org member may approve.

### Changed

- **Tokens can no longer ride the 0-approval auto-approve path.** On a project
  configured to require 0 approvals, `POST /api/migrations` with `submit: true`
  used to land the migration directly in `approved`. Token-authenticated calls
  now get `403` and are told to create a draft and submit from the UI, because
  that path amounts to a token approving a migration. Browser sessions are
  unaffected. This is the only behavioral change to the documented REST
  contract; it narrows what a token can do, deliberately.

- **Project settings**: `allow_self_approval` (boolean) is replaced by
  `self_approvers` (email list) on `GET`/`PUT /api/projects/:id/settings`.
  Existing projects with the toggle on migrate to `self_approvers: ["*"]`, so
  behavior is preserved. The `Migration` payload now exposes the resolved
  `self_approvers` instead of `allow_self_approval`.

### Fixed

- **Multi-statement blocks are rejected at validation time** — a statement box
  holding several `;`-separated statements used to pass the syntax pre-check and
  then fail on apply (each block runs as a single query, on a connection without
  `multipleStatements`), leaving partially applied migrations. Creation now fails
  with "use one statement per block" on both the client and `POST
  /api/migrations`, for every engine — including those with no parser grammar.

## [1.2.0] - 2026-07-15

### Added

- **Deployer role** — read-only access plus permission to apply deployment
  migrations. Available in the invite and role dropdowns.
- **Deployment migrations** — a checkbox at creation marks a migration as
  shipping with a code deploy. Review works as usual, but only an admin or
  deployer can apply or schedule it; the project's releasers list is not
  honored. Marked with a 🚢 badge in the UI and a 🚢 Deployment title prefix
  in Slack.
- **Reviewers at creation** — pick reviewers on the create-migration form;
  they are @-mentioned in the Slack submit notification.
- Slack: the creator is cc'd on approved/applied replies.

### Changed

- `GET /api/users` is available to all signed-in members (it feeds the
  reviewer pickers); user mutations remain admin-only.

## [1.1.0] - 2026-07-01

### Added

- **Search highlighting** in the schema view and query-panel schema explorer —
  matched table and column names are highlighted (readable in both light and
  dark mode).
- **Slack endpoint** for notifications/integration.

### Changed

- Faster server startup: schema init is versioned via a new `server_config`
  table and forward-only migrations, so boots no longer re-check every table
  against the DB spec.
- Baseline schema now lives in `docs/schema.sql`, applied once to fresh
  databases.
- Enforced server-side rules and settings updates.

### Fixed

- Cleaner migration handling and general cleanup.

## [1.0.0] - 2026-06-29

The first release of Checkpoint — a workspace for querying your databases and
shipping schema changes with review and governance built in.

### Added

- **Query Studio** — read-only query workspace with multi-tab editing, a
  searchable schema explorer, and table / vertical result views. Supports
  MySQL-family engines (MySQL, Aurora MySQL, MariaDB, TiDB, StarRocks) and
  **Redis**, built on a pluggable per-engine driver interface. Save and share
  queries via shareable links.
- **Migrations** — propose, review, comment on, approve, and apply schema
  migrations with a full audit trail. Per-project governance: designated
  approvers and releasers, configurable required-approval counts, and an
  **author self-approval** toggle (default off).
- **Org & project structure** — organizations → projects → environments →
  databases, with role-based capabilities and connection secrets encrypted at
  rest.
- **Platform** — Bun + React/TypeScript, schema auto-migration on boot,
  email/Slack notifications, and an audit log across all sensitive actions.

[Unreleased]: https://github.com/myyogateacher/checkpoint/compare/1.5.0...HEAD
[1.5.0]: https://github.com/myyogateacher/checkpoint/compare/1.4.0...1.5.0
[1.4.0]: https://github.com/myyogateacher/checkpoint/compare/1.3.0...1.4.0
[1.3.0]: https://github.com/myyogateacher/checkpoint/compare/1.2.0...1.3.0
[1.2.0]: https://github.com/myyogateacher/checkpoint/compare/1.1.0...1.2.0
[1.1.0]: https://github.com/myyogateacher/checkpoint/compare/1.0.0...1.1.0
[1.0.0]: https://github.com/myyogateacher/checkpoint/releases/tag/1.0.0
