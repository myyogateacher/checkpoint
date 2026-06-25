import { Link } from 'react-router-dom'
import { FaCodeBranch } from 'react-icons/fa'
import type { Migration } from '../types'
import { formatDate } from '../lib/format'
import { EngineBadge, StatusBadge } from './badges'
import { EmptyState } from './ui'

export function MigrationTable({
  migrations,
  showDatabase = true,
}: {
  migrations: Migration[]
  showDatabase?: boolean
}) {
  if (migrations.length === 0) {
    return <EmptyState icon={<FaCodeBranch />} title="No migrations yet" hint="Create one to propose a change." />
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/60">
      <table className="w-full text-sm">
        <thead className="bg-white/50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Title</th>
            {showDatabase ? <th className="px-4 py-3 font-medium">Database</th> : null}
            <th className="px-4 py-3 font-medium">Queries</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Author</th>
            <th className="px-4 py-3 font-medium">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200/50">
          {migrations.map((m) => (
            <tr key={m.id} className="bg-white/30 transition hover:bg-white/60">
              <td className="px-4 py-3">
                <Link
                  to={`/migrations/${m.id}`}
                  className="font-medium text-indigo-700 hover:underline dark:text-indigo-400"
                >
                  {m.title}
                </Link>
              </td>
              {showDatabase ? (
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] text-slate-700">{m.database_name}</span>
                    <EngineBadge engine={m.engine} />
                  </div>
                </td>
              ) : null}
              <td className="px-4 py-3 text-slate-600">{m.queries.length}</td>
              <td className="px-4 py-3">
                <StatusBadge status={m.status} />
              </td>
              <td className="px-4 py-3 text-slate-600">{m.author_email}</td>
              <td className="px-4 py-3 text-slate-500">{formatDate(m.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
