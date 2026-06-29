import type { MigrationStatus, UserRole } from '../types'

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

export function formatRows(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// Engine labels/styles live in the engine registry; re-exported for compatibility.
export { ENGINE_LABELS, ENGINE_STYLES } from './engines'

export const ROLE_STYLES: Record<UserRole, string> = {
  admin: 'border-indigo-200/70 bg-indigo-50/80 text-indigo-700',
  editor: 'border-blue-200/70 bg-blue-50/80 text-blue-700',
  viewer: 'border-slate-200/70 bg-slate-50/80 text-slate-600',
}

export const STATUS_META: Record<MigrationStatus, { label: string; style: string }> = {
  draft: { label: 'Draft', style: 'border-slate-200/70 bg-slate-50/80 text-slate-600' },
  pending_approval: { label: 'Pending approval', style: 'border-amber-200/70 bg-amber-50/80 text-amber-700' },
  approved: { label: 'Approved', style: 'border-sky-200/70 bg-sky-50/80 text-sky-700' },
  rejected: { label: 'Rejected', style: 'border-rose-200/70 bg-rose-50/80 text-rose-700' },
  running: { label: 'Running', style: 'border-blue-200/70 bg-blue-50/80 text-blue-700' },
  applied: { label: 'Applied', style: 'border-emerald-200/70 bg-emerald-50/80 text-emerald-700' },
  failed: { label: 'Failed', style: 'border-rose-200/70 bg-rose-50/80 text-rose-700' },
}

// --- Audit log categorisation ----------------------------------------------

export type AuditCategory = 'system' | 'migration' | 'manual'

// Derive a high-level category from an action key so the audit log can be
// filtered without storing a separate column.
export function auditCategory(action: string): AuditCategory {
  if (action.startsWith('migration.')) return 'migration'
  // Operator-initiated actions against a target database.
  if (action.startsWith('schema.') || action.startsWith('query.')) return 'manual'
  // user.*, role.*, connection.*, project.*, environment.* — config changes.
  return 'system'
}

export const AUDIT_FILTERS: Array<{ value: AuditCategory | 'all'; label: string; hint: string }> = [
  { value: 'all', label: 'All', hint: 'Every recorded action' },
  { value: 'system', label: 'System changes', hint: 'Users, roles, connections, config' },
  { value: 'migration', label: 'Migration changes', hint: 'Created, approved, applied, rejected' },
  { value: 'manual', label: 'Manual actions', hint: 'Schema syncs and read queries' },
]

// Capability matrix mirrored on the backend; the client uses it to gate UI.
export function can(role: UserRole | undefined, capability: 'edit' | 'approve' | 'manage_users'): boolean {
  if (!role) return false
  if (role === 'admin') return true
  if (role === 'editor') return capability === 'edit'
  return false
}
