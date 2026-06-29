// Server-side domain types. These mirror the response shapes the frontend
// expects (see src/types.ts) — they are the API contract.

export type UserRole = 'admin' | 'editor' | 'viewer'
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
