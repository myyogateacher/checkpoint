// Server-side domain types. These mirror the response shapes the frontend
// expects (see src/types.ts) — they are the API contract.

export type UserRole = 'admin' | 'editor' | 'deployer' | 'viewer'
export type ConnectionMode = 'read' | 'write'
export type MigrationStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'running'
  | 'applied'
  | 'failed'

export interface SessionUser {
  id: string
  email: string
  name: string
  picture: string | null
  role: UserRole
}

// --- API tokens --------------------------------------------------------------

export type ApiTokenScope =
  | 'migrations:read'
  | 'migrations:write'
  | 'catalog:read'
  | 'queries:read'
  | 'audit:read'

export interface ApiToken {
  id: string
  name: string
  token_prefix: string
  scopes: ApiTokenScope[]
  created_at: string
  expires_at: string | null
  last_used_at: string | null
  revoked_at: string | null
}

// Returned only from create; the secret is never retrievable again.
export interface ApiTokenCreated extends ApiToken {
  token: string
}
