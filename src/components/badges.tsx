import type { DatabaseEngine, MigrationStatus, UserRole } from '../types'
import { ENGINE_LABELS, ENGINE_STYLES, ROLE_STYLES, STATUS_META } from '../lib/format'
import { Badge } from './ui'

export function EngineBadge({ engine }: { engine: DatabaseEngine }) {
  return <Badge className={ENGINE_STYLES[engine]}>{ENGINE_LABELS[engine]}</Badge>
}

export function RoleBadge({ role }: { role: UserRole }) {
  return <Badge className={`capitalize ${ROLE_STYLES[role]}`}>{role}</Badge>
}

export function StatusBadge({ status }: { status: MigrationStatus }) {
  const meta = STATUS_META[status]
  return <Badge className={meta.style}>{meta.label}</Badge>
}

const CONN_STYLES = {
  read: 'border-emerald-200/70 bg-emerald-50/80 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/25 dark:text-emerald-200',
  write: 'border-rose-200/70 bg-rose-50/80 text-rose-700 dark:border-rose-400/40 dark:bg-rose-500/25 dark:text-rose-200',
}

const CONN_LABELS = { read: 'Read', write: 'Write' }

export function ConnectionBadge({ mode }: { mode: 'read' | 'write' }) {
  return <Badge className={CONN_STYLES[mode]}>{CONN_LABELS[mode]}</Badge>
}

export function TagList({ tags, className = '' }: { tags: string[]; className?: string }) {
  if (tags.length === 0) return null
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center rounded-md border border-slate-200/70 bg-white/60 px-2 py-0.5 text-[11px] font-medium text-slate-600"
        >
          #{tag}
        </span>
      ))}
    </div>
  )
}
