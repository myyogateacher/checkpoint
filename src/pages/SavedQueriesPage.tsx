import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FaBookmark, FaLink, FaSearch } from 'react-icons/fa'
import { api } from '../services/api'
import type { SavedQuery } from '../types'
import { formatDate } from '../lib/format'
import { PageHeader } from '../components/PageHeader'
import { EngineBadge, TagList } from '../components/badges'
import { Card, EmptyState, Spinner, TextInput } from '../components/ui'

export function SavedQueriesPage() {
  const navigate = useNavigate()
  const [queries, setQueries] = useState<SavedQuery[] | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    void api.getSavedQueries().then(setQueries)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!queries) return []
    if (!q) return queries
    return queries.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q) ||
        s.database_name.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q)),
    )
  }, [queries, query])

  return (
    <>
      <PageHeader
        eyebrow="Library"
        title="Saved Queries"
        description="Reusable read queries. Open one to load it into Query Studio with its database preselected."
      />

      <Card className="p-5">
        <div className="relative mb-4 max-w-sm">
          <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={12} />
          <TextInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, database, or tag…"
            className="pl-9"
          />
        </div>

        {queries === null ? (
          <Spinner label="Loading saved queries…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<FaBookmark />}
            title={query ? 'No matching queries' : 'No saved queries yet'}
            hint={query ? `Nothing matches “${query}”.` : 'Save or share a query from the read panel to see it here.'}
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200/60">
            <table className="w-full text-sm">
              <thead className="bg-white/50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Database</th>
                  <th className="px-4 py-3 font-medium">Tags</th>
                  <th className="px-4 py-3 font-medium">Author</th>
                  <th className="px-4 py-3 font-medium">Saved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/50">
                {filtered.map((q) => (
                  <tr
                    key={q.id}
                    onClick={() => navigate(`/query?saved=${q.id}`)}
                    className="cursor-pointer bg-white/30 transition hover:bg-white/60"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-indigo-700 dark:text-indigo-400">{q.name}</span>
                        {q.shared ? <FaLink className="text-slate-400" size={10} title="Shared" /> : null}
                      </div>
                      {q.description ? (
                        <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{q.description}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[13px] text-slate-700 dark:text-slate-300">{q.database_name}</span>
                        <EngineBadge engine={q.engine} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {q.tags.length ? <TagList tags={q.tags} /> : <span className="text-xs text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{q.author_email}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(q.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
