import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FaChevronRight, FaCodeBranch, FaDatabase, FaSearch, FaSync, FaUserShield } from 'react-icons/fa'
import { api } from '../services/api'
import type { AuditLogEntry } from '../types'
import { AUDIT_FILTERS, auditCategory, formatDate, type AuditCategory } from '../lib/format'
import { PageHeader } from '../components/PageHeader'
import { Card, EmptyState, Spinner, TextInput } from '../components/ui'

const ACTION_ICON: Record<string, React.ReactNode> = {
  migration: <FaCodeBranch className="text-indigo-500" />,
  database: <FaDatabase className="text-sky-500" />,
  user: <FaUserShield className="text-amber-500" />,
}

export function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<AuditCategory | 'all'>('all')

  useEffect(() => {
    void api.getAuditLogs().then(setLogs)
  }, [])

  // Sort newest-first once; filtering/searching happens on top of this.
  const sorted = useMemo(
    () => (logs ? [...logs].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)) : null),
    [logs],
  )

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: sorted?.length ?? 0 }
    for (const l of sorted ?? []) {
      const c = auditCategory(l.action)
      map[c] = (map[c] ?? 0) + 1
    }
    return map
  }, [sorted])

  const filtered = sorted?.filter((l) => {
    if (category !== 'all' && auditCategory(l.action) !== category) return false
    const q = query.toLowerCase()
    return (
      !q ||
      l.summary.toLowerCase().includes(q) ||
      l.actor_email.toLowerCase().includes(q) ||
      l.entity_label.toLowerCase().includes(q) ||
      l.action.toLowerCase().includes(q)
    )
  })

  return (
    <>
      <PageHeader
        eyebrow="Accountability"
        title="Audit Log"
        description="An immutable record of every action taken in Checkpoint."
      />

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap gap-1 rounded-full border border-white/60 bg-white/55 p-1 md:max-w-fit">
          {AUDIT_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setCategory(f.value)}
              title={f.hint}
              className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                category === f.value
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white'
                  : 'text-slate-600 hover:bg-white/75'
              }`}
            >
              {f.label}
              <span className={`text-xs ${category === f.value ? 'text-white/80' : 'text-slate-400'}`}>
                {counts[f.value] ?? 0}
              </span>
            </button>
          ))}
        </div>

        <div className="relative mb-4 max-w-sm">
          <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={12} />
          <TextInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search actor, action, entity…"
            className="pl-9"
          />
        </div>

        {sorted === null ? (
          <Spinner />
        ) : filtered && filtered.length === 0 ? (
          <EmptyState icon={<FaSync />} title="No matching entries" />
        ) : (
          <ol className="space-y-2">
            {filtered?.map((log) => {
              const href = log.entity_type === 'migration' && log.entity_id ? `/migrations/${log.entity_id}` : null
              const body = (
                <>
                  <div className="mt-0.5 text-base">
                    {ACTION_ICON[log.entity_type] ?? <FaSync className="text-slate-400" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-800 dark:text-slate-100">{log.summary}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      <span className="font-medium text-slate-600 dark:text-slate-300">
                        {log.actor_name ?? log.actor_email}
                      </span>
                      {' · '}
                      <span className="font-mono">{log.action}</span>
                      {' · '}
                      {formatDate(log.created_at)}
                    </p>
                  </div>
                  {href ? <FaChevronRight className="mt-1 shrink-0 text-slate-300" size={12} /> : null}
                </>
              )

              return (
                <li key={log.id}>
                  {href ? (
                    <Link
                      to={href}
                      className="flex items-start gap-3 rounded-xl border border-slate-200/60 bg-white/40 px-4 py-3 transition hover:border-indigo-300/70 hover:bg-white/70"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-start gap-3 rounded-xl border border-slate-200/60 bg-white/40 px-4 py-3">
                      {body}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </Card>
    </>
  )
}
