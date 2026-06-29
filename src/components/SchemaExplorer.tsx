import { useEffect, useMemo, useState } from 'react'
import { FaChevronDown, FaChevronRight, FaDatabase, FaKey, FaSearch, FaTable } from 'react-icons/fa'
import { api } from '../services/api'
import type { Database, SchemaSnapshot } from '../types'
import { ENGINE_LABELS } from '../lib/format'
import { engineDot } from '../lib/engines'

// Searchable schema tree shown alongside the query editor:
// database → tables → columns [type]. Click a name to insert it into the query.
export function SchemaExplorer({ database, onInsert }: { database: Database; onInsert?: (text: string) => void }) {
  const [snapshot, setSnapshot] = useState<SchemaSnapshot | null | undefined>(null)
  const [query, setQuery] = useState('')
  const [dbOpen, setDbOpen] = useState(true)
  const [openTables, setOpenTables] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setSnapshot(null)
    void api.getSchema(database.id).then((s) => setSnapshot(s ?? undefined))
  }, [database.id])

  const q = query.trim().toLowerCase()

  // Filter tables/columns by the search term. A table is shown if its name
  // matches or any of its columns match; matching tables auto-expand.
  const filtered = useMemo(() => {
    if (!snapshot) return []
    return snapshot.tables
      .map((t) => {
        const tableMatch = t.name.toLowerCase().includes(q)
        const cols = q && !tableMatch ? t.columns.filter((c) => c.name.toLowerCase().includes(q)) : t.columns
        return { table: t, cols, include: !q || tableMatch || cols.length > 0 }
      })
      .filter((r) => r.include)
  }, [snapshot, q])

  function toggleTable(name: string) {
    setOpenTables((prev) => ({ ...prev, [name]: !prev[name] }))
  }

  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="shrink-0 border-b border-slate-200/60 p-2">
        <div className="relative">
          <FaSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={11} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tables & columns"
            className="w-full rounded-lg border py-1.5 pl-7 pr-2 text-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200/60"
          />
        </div>
      </div>

      {/* Tree */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2 text-sm">
        {snapshot === null ? (
          <p className="px-1 py-2 text-xs text-slate-400">Loading…</p>
        ) : snapshot === undefined ? (
          <p className="px-1 py-2 text-xs text-slate-500">No schema yet. Pull it from the Schema tab to explore.</p>
        ) : (
          <>
            <button
              onClick={() => setDbOpen((o) => !o)}
              className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 font-medium text-slate-700 transition hover:bg-white/60 dark:text-slate-200"
              title={ENGINE_LABELS[database.engine]}
            >
              <span className="text-slate-400">{dbOpen ? <FaChevronDown size={9} /> : <FaChevronRight size={9} />}</span>
              <span className={`h-2 w-2 rounded-full ${engineDot(database.engine)}`} />
              <FaDatabase size={11} className="text-slate-400" />
              <span className="truncate font-mono text-[13px]">{database.name}</span>
            </button>

            {dbOpen ? (
              filtered.length === 0 ? (
                <p className="px-2 py-2 text-xs text-slate-400">No matches.</p>
              ) : (
                <div className="ml-2">
                  {filtered.map(({ table, cols }) => {
                    const expanded = q ? true : !!openTables[table.name]
                    return (
                      <div key={table.name}>
                        <div className="flex items-center">
                          <button
                            onClick={() => toggleTable(table.name)}
                            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-slate-600 transition hover:bg-white/60 dark:text-slate-300"
                          >
                            <span className="text-slate-400">
                              {expanded ? <FaChevronDown size={9} /> : <FaChevronRight size={9} />}
                            </span>
                            <FaTable size={10} className="text-indigo-400" />
                            <span
                              className="truncate font-mono text-[13px]"
                              onClick={(e) => {
                                if (onInsert) {
                                  e.stopPropagation()
                                  onInsert(table.name)
                                }
                              }}
                            >
                              {table.name}
                            </span>
                            <span className="ml-auto pl-1 text-[10px] text-slate-400">{table.columns.length}</span>
                          </button>
                        </div>

                        {expanded ? (
                          <ul className="ml-5 border-l border-slate-200/60 pl-2">
                            {cols.map((col) => (
                              <li key={col.name}>
                                <button
                                  onClick={() => onInsert?.(col.name)}
                                  className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left transition hover:bg-white/60"
                                  title={onInsert ? 'Insert column name' : undefined}
                                >
                                  {col.is_primary_key ? (
                                    <FaKey size={8} className="shrink-0 text-amber-500" />
                                  ) : (
                                    <span className="w-2 shrink-0" />
                                  )}
                                  <span className="truncate font-mono text-[12px] text-slate-700 dark:text-slate-300">
                                    {col.name}
                                  </span>
                                  <span className="ml-auto truncate pl-1 font-mono text-[11px] text-sky-600 dark:text-sky-400">
                                    {col.data_type}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
