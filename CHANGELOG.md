# Changelog

All notable changes to Checkpoint are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

- **Project settings**: `allow_self_approval` (boolean) is replaced by
  `self_approvers` (email list) on `GET`/`PUT /api/projects/:id/settings`.
  Existing projects with the toggle on migrate to `self_approvers: ["*"]`, so
  behavior is preserved. The `Migration` payload now exposes the resolved
  `self_approvers` instead of `allow_self_approval`.

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

[Unreleased]: https://github.com/myyogateacher/checkpoint/compare/1.2.0...HEAD
[1.2.0]: https://github.com/myyogateacher/checkpoint/compare/1.1.0...1.2.0
[1.1.0]: https://github.com/myyogateacher/checkpoint/compare/1.0.0...1.1.0
[1.0.0]: https://github.com/myyogateacher/checkpoint/releases/tag/1.0.0
