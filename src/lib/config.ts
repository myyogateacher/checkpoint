// Feature flags sourced from Vite env vars (build-time).

// Show the email/password login & signup forms. Set
// VITE_ENABLE_PASSWORD_AUTH=false to hide them and offer Google sign-in only.
// Defaults to enabled when the var is unset.
export const PASSWORD_AUTH_ENABLED = import.meta.env.VITE_ENABLE_PASSWORD_AUTH !== 'false'

// Bind the whole deployment to a single organization. When VITE_ORG is set, that
// org is created automatically, every user belongs to it, and no further
// organizations can be created (single-tenant lock). Unset = multi-tenant.
export const LOCKED_ORG_NAME = (import.meta.env.VITE_ORG ?? '').trim()
export const ORG_LOCKED = LOCKED_ORG_NAME.length > 0

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}
