import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FaPlus } from 'react-icons/fa'
import { api } from '../services/api'
import type { MigrationsPage, MigrationStatus } from '../types'
import { STATUS_META, can } from '../lib/format'
import { useAuth } from '../context/AuthContext'
import { useOrg } from '../context/OrgContext'
import { PageHeader } from '../components/PageHeader'
import { Button, Card, Spinner } from '../components/ui'
import { MigrationTable } from '../components/MigrationTable'
import { Pagination } from '../components/Pagination'

const FILTERS: Array<{ value: MigrationStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending_approval', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'applied', label: 'Applied' },
  { value: 'draft', label: 'Drafts' },
  { value: 'rejected', label: 'Rejected' },
]

const DEFAULT_PAGE_SIZE = 25
const PAGE_SIZES = [10, 25, 50, 100]
// Only the sizes the pager offers are honored; anything else in the URL falls back.
const readPageSize = (v: string | null): number => {
  const n = Number(v)
  return PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE
}

const isStatus = (v: string | null): v is MigrationStatus =>
  !!v && FILTERS.some((f) => f.value === v && f.value !== 'all')

export function MigrationsListPage() {
  const { user } = useAuth()
  const { currentOrgId } = useOrg()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<MigrationsPage | null>(null)
  // Refreshing an already-rendered page: keep the old rows on screen (dimmed)
  // instead of blanking the table back to a spinner.
  const [refreshing, setRefreshing] = useState(false)

  // Page/status/size live in the URL so back and refresh keep the position.
  const filter: MigrationStatus | 'all' = isStatus(searchParams.get('status'))
    ? (searchParams.get('status') as MigrationStatus)
    : 'all'
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const pageSize = readPageSize(searchParams.get('page_size'))

  const patchParams = useCallback(
    (patch: Record<string, string | null>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(patch)) {
            if (value === null) next.delete(key)
            else next.set(key, value)
          }
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  // Switching org changes what the current page even means, so go back to page 1.
  const knownOrg = useRef(currentOrgId)
  useEffect(() => {
    if (knownOrg.current === currentOrgId) return
    knownOrg.current = currentOrgId
    patchParams({ page: '1' })
  }, [currentOrgId, patchParams])

  useEffect(() => {
    let cancelled = false
    setRefreshing(true)
    void api
      .getMigrationsPage({
        org: currentOrgId ?? undefined,
        status: filter === 'all' ? undefined : filter,
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
  }, [currentOrgId, filter, page, pageSize])

  const counts = data?.counts
  const total = data?.total ?? 0

  return (
    <>
      <PageHeader
        eyebrow="Change control"
        title="Migrations"
        description="Every schema change across all databases. Migrations require approval before they can be applied."
        actions={
          can(user?.role, 'edit') ? (
            <Link to="/migrations/new">
              <Button>
                <FaPlus size={12} /> New migration
              </Button>
            </Link>
          ) : null
        }
      />

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap gap-1 rounded-full border border-white/60 bg-white/55 p-1 md:max-w-fit">
          {FILTERS.map((f) => {
            const count = !counts
              ? 0
              : f.value === 'all'
                ? Object.values(counts).reduce((a, b) => a + b, 0)
                : counts[f.value] ?? 0
            return (
              <button
                key={f.value}
                onClick={() => patchParams({ status: f.value === 'all' ? null : f.value, page: '1' })}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                  filter === f.value
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white'
                    : 'text-slate-600 hover:bg-white/75'
                }`}
              >
                {f.label}
                <span className={`text-xs ${filter === f.value ? 'text-white/80' : 'text-slate-400'}`}>{count}</span>
              </button>
            )
          })}
        </div>

        {data === null ? (
          <Spinner />
        ) : (
          <>
            <div className={refreshing ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
              <MigrationTable migrations={data.items} />
            </div>
            <Pagination
              className="mt-4"
              total={total}
              page={data.page}
              pageSize={data.page_size}
              onPageChange={(next) => patchParams({ page: String(next) })}
              onPageSizeChange={(size) => patchParams({ page_size: String(size), page: '1' })}
            />
          </>
        )}
      </Card>

      <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-500">
        {(Object.keys(STATUS_META) as MigrationStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-full border ${STATUS_META[s].style}`} />
            {STATUS_META[s].label}
          </span>
        ))}
      </div>
    </>
  )
}
