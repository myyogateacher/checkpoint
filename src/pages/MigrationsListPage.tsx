import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FaPlus } from 'react-icons/fa'
import { api } from '../services/api'
import type { Migration, MigrationStatus } from '../types'
import { STATUS_META, can } from '../lib/format'
import { useAuth } from '../context/AuthContext'
import { PageHeader } from '../components/PageHeader'
import { Button, Card, Spinner } from '../components/ui'
import { MigrationTable } from '../components/MigrationTable'

const FILTERS: Array<{ value: MigrationStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending_approval', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'applied', label: 'Applied' },
  { value: 'draft', label: 'Drafts' },
  { value: 'rejected', label: 'Rejected' },
]

export function MigrationsListPage() {
  const { user } = useAuth()
  const [migrations, setMigrations] = useState<Migration[] | null>(null)
  const [filter, setFilter] = useState<MigrationStatus | 'all'>('all')

  useEffect(() => {
    void api.getMigrations().then(setMigrations)
  }, [])

  const filtered = useMemo(() => {
    if (!migrations) return []
    return filter === 'all' ? migrations : migrations.filter((m) => m.status === filter)
  }, [migrations, filter])

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
            const count =
              f.value === 'all'
                ? migrations?.length ?? 0
                : migrations?.filter((m) => m.status === f.value).length ?? 0
            return (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
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

        {migrations === null ? <Spinner /> : <MigrationTable migrations={filtered} />}
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
