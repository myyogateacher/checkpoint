# Changelog

All notable changes to Checkpoint are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/myyogateacher/checkpoint/compare/1.3.0...HEAD
[1.3.0]: https://github.com/myyogateacher/checkpoint/compare/1.2.0...1.3.0
[1.2.0]: https://github.com/myyogateacher/checkpoint/compare/1.1.0...1.2.0
[1.1.0]: https://github.com/myyogateacher/checkpoint/compare/1.0.0...1.1.0
[1.0.0]: https://github.com/myyogateacher/checkpoint/releases/tag/1.0.0
