# AGENTS.md

Conventions for AI agents and contributors working in this repo. Keep changes
consistent with what's already here.

## What this project is

Checkpoint is a database migration assistant. Today the **frontend is complete**
and the **backend is stubbed**. The frontend runs on in-memory mock data; the
real backend is planned. See [`README.md`](README.md) and
[`docs/features.md`](docs/features.md).

## Commands

```bash
bun install
bun run dev          # client :3000 + stub server :3001
bun run dev:client   # vite only
bun run typecheck    # tsc --noEmit — run before declaring done
bun run build        # vite build
bun run lint         # eslint
```

Always run `bun run typecheck` after changes. `tsconfig` has `noUnusedLocals` /
`noUnusedParameters` on, so remove unused imports/vars or it will fail.

## Architecture & where things live

- **Domain model:** [`src/types.ts`](src/types.ts) is the single source of truth
  and effectively the API contract. Update it first when changing data shapes.
- **Data access:** all network access goes through the `api` object in
  [`src/services/api.ts`](src/services/api.ts). Every method has two branches
  gated by `const USE_MOCKS`: a real `request<T>(path, …)` call and a mock branch
  that mutates [`src/services/mockData.ts`](src/services/mockData.ts). When you
  add an endpoint, add **both** branches and keep the real path accurate — that
  path is the backend contract.
- **Pages** live in `src/pages/` (one per screen). **Reusable UI** lives in
  `src/components/`. **Primitives** (Button, Card, Modal, Field, inputs,
  Spinner, EmptyState, ErrorBanner) are in
  [`src/components/ui.tsx`](src/components/ui.tsx).
- **Routing** is in [`src/App.tsx`](src/App.tsx). Nested layouts:
  `ProjectLayout` and `DatabaseLayout` load their entity and expose it via
  `useOutletContext` (`useProject()` / `useDatabase()`).
- **Auth/theme** are React contexts in `src/context/`.

## UI conventions

- **Styling:** Tailwind v4 (`@import "tailwindcss"` in
  [`src/index.css`](src/index.css)). No config file; theme is CSS.
- **Glass theme:** use the `glass-card` / `glass-panel` classes and the existing
  primitives rather than re-styling from scratch.
- **Dark mode** is class-based (`.dark` on `<html>`, toggled via `ThemeContext`).
  It is implemented by **remapping neutral utilities at the `.dark` scope** in
  `index.css` (e.g. `text-slate-*`, `bg-white/*`, `border-slate-*`) — NOT with
  per-element `dark:` variants for neutrals. Accent colors (indigo/emerald/rose/
  amber/sky) are intentionally untouched. **If you introduce a neutral shade not
  already mapped (e.g. `bg-white/45`), add a one-line override to the dark block
  in `index.css`** or it won't theme. This includes **variant** classes:
  `hover:bg-white/*` needs its own `.dark .hover\:bg-white\/NN:hover` override
  (the base-class remap does not cover the `hover:` variant), otherwise hovers
  turn near-white and hide light text.
- **Active nav/selection highlight:** use
  `bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300`
  (plain `bg-white/*` reads as flat gray in dark mode).
- **Dropdowns:** use [`Dropdown`](src/components/Dropdown.tsx) (portal-rendered,
  never clipped), not native `<select>`.
- **Feedback:** use `notify.success` / `notify.error` from
  [`src/lib/toast.tsx`](src/lib/toast.tsx) for create/update/delete actions.
  Keep inline `ErrorBanner` for form-level validation where it already exists.
- **Role gating:** use `can(role, 'edit' | 'approve' | 'manage_users')` from
  [`src/lib/format.ts`](src/lib/format.ts). Don't hardcode role checks.
- **Page chrome:** wrap screens with `PageHeader` (supports `breadcrumbs`) and,
  for database sub-pages, `DatabaseTabs`.

## Verifying changes

A preview/dev server is usually available. After a visual change, check it in
the browser (light **and** dark, and a mobile width) before finishing. Watch the
console for errors. Note: editing a file mid-flight can leave **stale Vite HMR
errors** in the log buffer — a server restart clears them; trust `typecheck` +
`build` for the real signal.

## When wiring the real backend

1. Implement the routes listed in [`docs/features.md`](docs/features.md) (they
   mirror the `request<T>(…)` paths in `api.ts`).
2. Flip `USE_MOCKS` to `false` in `api.ts`.
3. `request<T>` already sends `credentials: 'include'` and expects JSON with an
   `{ error }` field on failure — match that shape.
4. Secrets (connection passwords, SMTP password) are **write-only** from the
   client: the UI sends a value to set/replace and only ever receives a
   `has_password` boolean back. Never return secrets.

## Conventions

- Match the surrounding code's style; mirror existing comment density (concise
  "why" comments, not narration).
- Reference files as clickable paths in PRs/messages.
- Commit/push only when asked.
