# Checkpoint

A database migration assistant. Propose schema changes as reviewable migrations,
get them approved, apply them through a controlled write connection, and keep a
full audit trail. Browse live schema and run read-only queries against your
databases — all behind Google sign-in with role-based access.

> **Status:** Full stack wired end-to-end. The **frontend** (React) talks
> directly to the **backend** (Bun + TypeScript + MySQL) under
> [`server/`](server) over `fetch` with a session cookie — there is no mock
> layer. Sign-in uses **Google Identity Services**: the client renders the
> Google button, gets an ID token, and posts it to `POST /api/auth/google`,
> which the server verifies before creating the session. Set
> `VITE_GOOGLE_CLIENT_ID` (client) and `GOOGLE_CLIENT_ID` (server) to the same
> OAuth client.

## Screenshots

| Projects | Migration review |
| --- | --- |
| ![Projects dashboard](docs/images/projects.jpg) | ![Migration detail with reviewers & comments](docs/images/migration.jpg) |

| Schema browser | Query Studio (read panel) |
| --- | --- |
| ![Schema browser](docs/images/schema.jpg) | ![Query Studio with vertical result view](docs/images/query-studio.jpg) |

## Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, React Router 7, Vite
- **Notifications:** react-hot-toast (custom-themed)
- **Backend:** Bun + TypeScript, MySQL (`mysql2`), cookie sessions, Google ID-token verification (`google-auth-library`)
- **Deployment:** Docker (multi-stage) + docker-compose (app + MySQL)

## Core concepts

```
Project ─┬─ Environment (production / staging / development) ─┬─ Database
         │                                                    │   ├─ read connection   (schema pulls, read panel)
         │                                                    │   └─ write connection  (apply migrations)
```

A **migration** targets one database, carries one or more ordered SQL statements,
and moves through a lifecycle: `draft → pending_approval → approved → applied`
(or `rejected` / `failed`). Reviewers and threaded comments support the review.

## Features

1. **Google login** with role-based access (`admin` / `editor` / `deployer` / `viewer`).
2. **Structure tree** — Project → Environment → Database in a collapsible sidebar.
3. **Multi-engine** — PostgreSQL, MySQL, ClickHouse.
4. **Schema browser** — tables, columns, types, indexes, row estimates.
5. **Pull schema** — sync current structure from the database (read connection).
6. **Query Studio / read panel** — SELECT-only queries; results as a table or
   MySQL `\G`-style vertical view.
7. **Migrations** — multi-statement, create → submit → approve → apply, with
   reviewers, comments, and a per-migration audit trail.
8. **Read & write connections** per database.
9. **User management** — invite users, assign roles.
10. **Audit log** — system-wide, filterable record of actions.
11. **Settings** — email (SMTP) + Slack notification configuration (tabbed).
12. **API tokens** — self-service personal access tokens for programmatic
    access (create migrations from CI); see [`docs/api.md`](docs/api.md). The
    same tokens authenticate the **MCP server** for AI agents; see
    [`docs/mcp.md`](docs/mcp.md).
13. **UX** — dark mode, responsive mobile drawer, breadcrumbs, toasts.

See [`docs/features.md`](docs/features.md) for the full feature + data-model +
API specification used to plan the backend.

## Roles

| Capability                          | viewer | deployer | editor | admin |
| ----------------------------------- | :----: | :------: | :----: | :---: |
| Browse schema, run read queries     |   ✓    |    ✓     |   ✓    |   ✓   |
| Pull schema, create/submit migration|        |          |   ✓    |   ✓   |
| Add reviewers, comment              |        |          |   ✓    |   ✓   |
| Approve / reject / apply migration  |        |          |        |   ✓   |
| Apply **deployment** migrations     |        |    ✓     |        |   ✓   |
| Manage users, write connections, settings |  |          |        |   ✓   |

A **deployment migration** (checkbox at creation) ships together with a code
deploy: review works as usual, but only an admin or deployer can apply or
schedule it — the project's releasers list is not honored for these.

## Develop

```bash
bun install
bun run dev          # client (:3000) + stub server (:3001)
bun run typecheck
bun run build
bun run lint
```

`bun run dev` starts the client (:3000) and the backend (:3001); the Vite dev
server proxies `/api` to the backend. Sign-in needs a real Google OAuth client
(`VITE_GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_ID`) and a running MySQL — the first
Google account to sign in is bootstrapped as `admin`.

## Deploy

```bash
cp .env.example .env   # fill in Google OAuth + metadata DB
docker compose -f docker-compose.example.yml up --build
```

## Project layout

```
src/
  types.ts              domain model (the API contract in TS)
  services/
    api.ts              client; fetch wrapper over the backend API
  context/              AuthContext, ThemeContext
  lib/                  format helpers, toast
  components/           Layout, StructureTree, Dropdown, ui primitives, …
  pages/                one file per screen
server/
  index.ts              entry: Bun.serve, route registration, SPA static serving
  env.ts                env config (DB, session, Google, locked org)
  db/                   MySQL pool, schema.sql, idempotent init
  lib/                  http router, session, google verify, crypto, audit, auth
  modules/              one file per domain (auth, projects, migrations, …)
docs/features.md        feature + data model + API spec
```

## Backend (Bun + MySQL)

A structured server under [`server/`](server): a tiny path-param router, cookie
sessions backed by a `sessions` table, **Google ID-token verification** (the
client signs in with Google and POSTs the credential to `/api/auth/google`),
RBAC enforced server-side, encrypted connection secrets, and an append-only
audit log. The schema is applied idempotently on boot from
[`server/db/schema.sql`](server/db/schema.sql).

```bash
# needs a MySQL 8 running and APP_DATABASE_URL (or DB_* / GOOGLE_CLIENT_ID) set
bun run dev:server      # API + SPA on :3001 (watch mode)
bun run typecheck:server
```

Schema introspection, read queries, and migration apply connect to the managed
(external) databases — implemented today for **MySQL-family** engines via
`mysql2`; other engines return `501` until their drivers are added.

> **First sign-in** bootstraps an admin (the first Google account). After that,
> users must be invited. With `VITE_ORG` set, everyone joins that single org.

## API access

Automated callers (CI, scripts, tools) authenticate with **personal access
tokens** instead of a browser session. Create one in the app under **API
Tokens** (the secret is shown once), then:

```bash
curl -sS https://your-checkpoint/api/migrations \
  -H "Authorization: Bearer $CHECKPOINT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"database_id":"db_…","title":"Add index","queries":["CREATE INDEX …"],"submit":true}'
```

The migration lands in the normal review flow. Tokens are scoped, act as their
owner (same RBAC), and can never approve or apply a migration. Full reference:
[`docs/api.md`](docs/api.md).

### MCP (AI agents)

The same tokens authenticate an **MCP server** at `POST /api/mcp` (Streamable
HTTP, stateless), so an agent can read your catalog, migrations and audit trail,
and open migrations for review:

```bash
claude mcp add --transport http checkpoint \
  https://your-checkpoint/api/mcp --header "Authorization: Bearer $CHECKPOINT_TOKEN"
```

There is no tool for approve, reject, apply, schedule, or arbitrary SQL — those
stay human decisions made in the UI, enforced server-side in depth. Full
reference: [`docs/mcp.md`](docs/mcp.md).

## Related docs

- [`AGENTS.md`](AGENTS.md) — conventions for AI agents / contributors.
- [`docs/features.md`](docs/features.md) — backend planning spec.
- [`docs/api.md`](docs/api.md) — REST API reference (token auth, scopes, endpoints).
- [`docs/mcp.md`](docs/mcp.md) — MCP server reference (tools, scopes, excluded verbs).
