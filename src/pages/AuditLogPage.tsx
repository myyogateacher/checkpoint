import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FaChevronRight, FaCodeBranch, FaDatabase, FaSearch, FaSync, FaUserShield } from 'react-icons/fa'
import { api } from '../services/api'
import type { AuditLogPage as AuditPage } from '../types'
import { AUDIT_FILTERS, formatDate, type AuditCategory } from '../lib/format'
import { PageHeader } from '../components/PageHeader'
import { Card, EmptyState, Spinner, TextInput } from '../components/ui'
import { Pagination } from '../components/Pagination'

const ACTION_ICON: Record<string, React.ReactNode> = {
  migration: <FaCodeBranch className="text-indigo-500" />,
  database: <FaDatabase className="text-sky-500" />,
  user: <FaUserShield className="text-amber-500" />,
}

const DEFAULT_PAGE_SIZE = 25
const PAGE_SIZES = [10, 25, 50, 100]
// Only the sizes the pager offers are honored; anything else in the URL falls back.
const readPageSize = (v: string | null): number => {
  const n = Number(v)
  return PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE
}
const SEARCH_DEBOUNCE_MS = 300

const isCategory = (v: string | null): v is AuditCategory =>
  v === 'system' || v === 'migration' || v === 'manual'

export function AuditLogPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<AuditPage | null>(null)
  // Keep the current rows on screen (dimmed) while the next page loads.
  const [refreshing, setRefreshing] = useState(false)

  // Category, search and paging live in the URL so back and refresh keep position.
  const category: AuditCategory | 'all' = isCategory(searchParams.get('category'))
    ? (searchParams.get('category') as AuditCategory)
    : 'all'
  const q = searchParams.get('q') ?? ''
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const pageSize = readPageSize(searchParams.get('page_size'))

  // The input is local so typing stays responsive; the URL (and the request)
  // follow one debounce later.
  const [queryInput, setQueryInput] = useState(q)

  const patchParams = useCallback(
    (patch: Record<string, string | null>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === '') next.delete(key)
            else next.set(key, value)
          }
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  useEffect(() => {
    if (queryInput === q) return
    const timer = setTimeout(() => patchParams({ q: queryInput, page: '1' }), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [queryInput, q, patchParams])

  useEffect(() => {
    let cancelled = false
    setRefreshing(true)
    void api
      .getAuditLogsPage({
        category: category === 'all' ? undefined : category,
        q: q || undefined,
        page,
        pageSize,
      })
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .finally(() => {
        if (!cancelled) setRefreshing(false)
      })
    return () => {
      cancelled = true
    }
  }, [category, q, page, pageSize])

  const counts = data?.counts ?? { all: 0, system: 0, migration: 0, manual: 0 }
  const entries = data?.items ?? []

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
              onClick={() => patchParams({ category: f.value === 'all' ? null : f.value, page: '1' })}
              title={f.hint}
              className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                category === f.value
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white'
                  : 'text-slate-600 hover:bg-white/75'
              }`}
            >
              {f.label}
              <span className={`text-xs ${category === f.value ? 'text-white/80' : 'text-slate-400'}`}>
                {counts[f.value]}
              </span>
            </button>
          ))}
        </div>

        <div className="relative mb-4 max-w-sm">
          <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={12} />
          <TextInput
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="Search actor, action, entity…"
            className="pl-9"
          />
        </div>

        {data === null ? (
          <Spinner />
        ) : entries.length === 0 ? (
          <EmptyState icon={<FaSync />} title="No matching entries" />
        ) : (
          <div className={refreshing ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
            <ol className="space-y-2">
              {entries.map((log) => {
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
          </div>
        )}

        {data ? (
          <Pagination
            className="mt-4"
            total={data.total}
            page={data.page}
            pageSize={data.page_size}
            onPageChange={(next) => patchParams({ page: String(next) })}
            onPageSizeChange={(size) => patchParams({ page_size: String(size), page: '1' })}
          />
        ) : null}
      </Card>
    </>
  )
}
