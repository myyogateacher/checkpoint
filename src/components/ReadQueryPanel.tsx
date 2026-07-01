import { useEffect, useMemo, useRef, useState } from 'react'
import { FaColumns, FaDatabase, FaPencilAlt, FaPlay, FaPlus, FaSave, FaShareAlt, FaTable, FaTimes } from 'react-icons/fa'
import { api } from '../services/api'
import type { AppSettings, Database, Environment, Project, QueryResult } from '../types'
import { ENGINE_LABELS } from '../lib/format'
import { engineDialect, engineSupportsQuery } from '../lib/engines'
import { ConnectionBadge, EngineBadge } from './badges'
import { SchemaExplorer } from './SchemaExplorer'
import { SaveQueryModal } from './SaveQueryModal'
import { Button, Card, EmptyState, ErrorBanner, TextArea } from './ui'
import { Dropdown } from './Dropdown'

type ViewMode = 'table' | 'vertical'

// One editor tab: its own database selection, SQL, result, and view mode.
interface QueryTab {
  id: string
  name: string
  projectId: string
  environmentId: string
  databaseId: string
  picking: boolean
  sql: string
  result: QueryResult | null
  error: string | null
  running: boolean
  view: ViewMode
}

function makeTab(n: number, fixedDatabaseId?: string): QueryTab {
  return {
    id: `tab_${n}_${Math.floor(performance.now())}`,
    name: `Query ${n}`,
    projectId: '',
    environmentId: '',
    databaseId: fixedDatabaseId ?? '',
    picking: !fixedDatabaseId,
    sql: 'SELECT * FROM users LIMIT 50;',
    result: null,
    error: null,
    running: false,
    view: 'table',
  }
}

// Read-only query workspace. Each tab can target its own database (Query
// Studio), or every tab is locked to `fixedDatabaseId` (a database's own tab).
export function ReadQueryPanel({
  databases,
  projects = [],
  environments = [],
  fixedDatabaseId,
  initialQuery,
}: {
  databases: Database[]
  projects?: Project[]
  environments?: Environment[]
  fixedDatabaseId?: string
  // Seed the first tab with a database + SQL (e.g. opening a saved query).
  initialQuery?: { databaseId: string; sql: string; name?: string }
}) {
  const selectable = !fixedDatabaseId
  const counter = useRef(1)
  const [tabs, setTabs] = useState<QueryTab[]>(() => {
    const t = makeTab(1, fixedDatabaseId)
    if (initialQuery) {
      const db = databases.find((d) => d.id === initialQuery.databaseId)
      return [
        {
          ...t,
          name: initialQuery.name ?? t.name,
          databaseId: initialQuery.databaseId,
          projectId: db?.project_id ?? '',
          environmentId: db?.environment_id ?? '',
          picking: false,
          sql: initialQuery.sql,
        },
      ]
    }
    return [t]
  })
  const [activeId, setActiveId] = useState(() => tabs[0].id)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saveMode, setSaveMode] = useState<'save' | 'share' | null>(null)
  const [querySettings, setQuerySettings] = useState<AppSettings['query'] | null>(null)
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]
  const activeDb = databases.find((d) => d.id === active.databaseId)
  // SQL engines have a sql-formatter dialect; schema-less stores (Redis) don't,
  // which gates the schema explorer, the editor placeholder, and the hint copy.
  const isSqlEngine = activeDb ? engineDialect(activeDb.engine) !== null : true

  useEffect(() => {
    void api.getSettings().then((s) => setQuerySettings(s.query))
  }, [])

  const projectEnvs = useMemo(
    () => environments.filter((e) => e.project_id === active.projectId),
    [environments, active.projectId],
  )
  // Only query-capable engines can be targeted from the read panel.
  const envDatabases = useMemo(
    () => databases.filter((d) => d.environment_id === active.environmentId && engineSupportsQuery(d.engine)),
    [databases, active.environmentId],
  )
  const projectName = projects.find((p) => p.id === activeDb?.project_id)?.name
  const envName = environments.find((e) => e.id === activeDb?.environment_id)?.name

  function patch(id: string, p: Partial<QueryTab>) {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...p } : t)))
  }

  function addTab() {
    counter.current += 1
    const t = makeTab(counter.current, fixedDatabaseId)
    setTabs((prev) => [...prev, t])
    setActiveId(t.id)
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      if (prev.length === 1) return prev
      const idx = prev.findIndex((t) => t.id === id)
      const next = prev.filter((t) => t.id !== id)
      if (id === activeId) setActiveId((next[idx] ?? next[next.length - 1]).id)
      return next
    })
  }

  async function run() {
    if (!active.databaseId) return
    let sql = active.sql
    // Auto-format on run (per settings) when the engine has a SQL dialect.
    const dialect = activeDb ? engineDialect(activeDb.engine) : null
    if (querySettings?.format_on_run && dialect) {
      try {
        // Lazy-loaded so sql-formatter isn't in the initial bundle.
        const { format } = await import('sql-formatter')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sql = format(active.sql, { language: dialect as any, keywordCase: 'upper' })
        patch(active.id, { sql })
      } catch {
        /* keep the user's SQL as-is if it can't be formatted */
      }
    }
    patch(active.id, { running: true, error: null })
    try {
      const result = await api.runReadQuery(active.databaseId, sql)
      patch(active.id, { result, running: false })
    } catch (err) {
      patch(active.id, { result: null, running: false, error: err instanceof Error ? err.message : 'Query failed' })
    }
  }

  function insertIdentifier(text: string) {
    const cur = active.sql
    const sep = cur && !/\s$/.test(cur) ? ' ' : ''
    patch(active.id, { sql: cur + sep + text })
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex min-h-[460px]">
        {/* Left column: searchable schema explorer for the active tab's db */}
        <div className="relative hidden w-60 shrink-0 border-r border-slate-200/60 bg-white/20 md:block">
          <div className="absolute inset-0">
            {activeDb ? (
              isSqlEngine ? (
                <SchemaExplorer database={activeDb} onInsert={insertIdentifier} />
              ) : (
                <div className="flex h-full items-center justify-center p-4 text-center text-xs text-slate-400">
                  Schema browsing isn't available for {ENGINE_LABELS[activeDb.engine]}.
                </div>
              )
            ) : (
              <div className="flex h-full items-center justify-center p-4 text-center text-xs text-slate-400">
                Select a database to explore its tables.
              </div>
            )}
          </div>
        </div>

        {/* Right column: tabs + selection + editor + result */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Tab strip */}
          <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200/60 px-2 pt-2">
            {tabs.map((t) => {
              const isActive = t.id === activeId
              return (
                <div
                  key={t.id}
                  className={`group flex shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 px-3 py-1.5 text-sm transition ${
                    isActive
                      ? 'border-slate-200/60 bg-white/50 font-medium text-slate-800 dark:bg-white/10'
                      : 'border-transparent text-slate-500 hover:bg-white/40'
                  }`}
                >
                  {editingId === t.id ? (
                    <input
                      autoFocus
                      value={t.name}
                      onChange={(e) => patch(t.id, { name: e.target.value })}
                      onBlur={() => setEditingId(null)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === 'Escape') setEditingId(null)
                      }}
                      className="w-24 rounded border-0 bg-transparent p-0 text-sm outline-none focus:ring-0"
                    />
                  ) : (
                    <button
                      onClick={() => setActiveId(t.id)}
                      onDoubleClick={() => setEditingId(t.id)}
                      title="Double-click to rename"
                      className="cursor-pointer whitespace-nowrap"
                    >
                      {t.name}
                    </button>
                  )}
                  {editingId !== t.id ? (
                    <button
                      onClick={() => {
                        setActiveId(t.id)
                        setEditingId(t.id)
                      }}
                      className={`cursor-pointer rounded p-0.5 text-slate-400 transition hover:text-indigo-500 ${
                        isActive ? 'opacity-70' : 'opacity-0 group-hover:opacity-70'
                      }`}
                      aria-label={`Rename ${t.name}`}
                      title="Rename"
                    >
                      <FaPencilAlt size={9} />
                    </button>
                  ) : null}
                  {tabs.length > 1 ? (
                    <button
                      onClick={() => closeTab(t.id)}
                      className="cursor-pointer rounded p-0.5 text-slate-400 opacity-60 transition hover:text-rose-500 group-hover:opacity-100"
                      aria-label={`Close ${t.name}`}
                    >
                      <FaTimes size={10} />
                    </button>
                  ) : null}
                </div>
              )
            })}
            <button
              onClick={addTab}
              className="ml-1 shrink-0 cursor-pointer rounded-md p-1.5 text-slate-400 transition hover:bg-white/60 hover:text-slate-700 dark:hover:text-slate-200"
              title="New query tab"
              aria-label="New query tab"
            >
              <FaPlus size={12} />
            </button>
          </div>

          {/* Active tab body */}
          <div className="space-y-4 p-5">
            {/* Per-tab database selection (Query Studio only) */}
            {selectable ? (
              activeDb && !active.picking ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200/60 bg-white/30 px-3 py-2">
                  <FaDatabase className="text-slate-400" size={12} />
                  <span className="text-xs text-slate-500">
                    {projectName} / {envName} /
                  </span>
                  <span className="font-mono text-sm text-slate-800 dark:text-slate-100">{activeDb.name}</span>
                  <EngineBadge engine={activeDb.engine} />
                  <Button variant="secondary" className="ml-auto !py-1" onClick={() => patch(active.id, { picking: true })}>
                    Change
                  </Button>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-3">
                  <Dropdown
                    value={active.projectId}
                    placeholder="Project…"
                    options={projects.map((p) => ({ value: p.id, label: p.name }))}
                    onChange={(v) => patch(active.id, { projectId: v, environmentId: '', databaseId: '' })}
                  />
                  <Dropdown
                    value={active.environmentId}
                    placeholder={active.projectId ? 'Environment…' : '—'}
                    disabled={!active.projectId}
                    options={projectEnvs.map((e) => ({ value: e.id, label: e.name }))}
                    onChange={(v) => patch(active.id, { environmentId: v, databaseId: '' })}
                  />
                  <Dropdown
                    value={active.databaseId}
                    placeholder={active.environmentId ? 'Database…' : '—'}
                    disabled={!active.environmentId}
                    options={envDatabases.map((d) => ({ value: d.id, label: `${d.name} · ${ENGINE_LABELS[d.engine]}` }))}
                    onChange={(v) => patch(active.id, { databaseId: v, picking: false })}
                  />
                </div>
              )
            ) : null}

            {activeDb ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-slate-800">Read panel</h2>
                    <ConnectionBadge mode="read" />
                  </div>
                  <p className="text-xs text-slate-500">
                    Read-only — runs on <span className="font-mono">{activeDb.read_connection.host}</span>.{' '}
                    {isSqlEngine
                      ? 'Only SELECT / SHOW / WITH / EXPLAIN are permitted.'
                      : 'Only read-only Redis commands (GET, HGETALL, LRANGE…) are permitted.'}
                    {querySettings ? ` Timeout ${querySettings.default_timeout_seconds}s.` : ''}
                  </p>
                </div>

                <TextArea
                  rows={6}
                  value={active.sql}
                  onChange={(e) => patch(active.id, { sql: e.target.value })}
                  spellCheck={false}
                  placeholder={isSqlEngine ? 'SELECT ...' : 'GET mykey'}
                />

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setSaveMode('save')} disabled={!active.sql.trim()}>
                      <FaSave size={12} /> Save
                    </Button>
                    <Button variant="secondary" onClick={() => setSaveMode('share')} disabled={!active.sql.trim()}>
                      <FaShareAlt size={11} /> Share query
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    {active.result ? (
                      <span className="text-xs text-slate-500">
                        {active.result.row_count} rows · {active.result.duration_ms} ms
                      </span>
                    ) : null}
                    <Button onClick={run} loading={active.running}>
                      {!active.running ? <FaPlay size={11} /> : null} Run query
                    </Button>
                  </div>
                </div>

                <ErrorBanner message={active.error} />

                {active.result ? (
                  <div className="border-t border-slate-200/60 pt-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-800">Result</h3>
                      <div className="flex gap-1 rounded-full border border-white/60 bg-white/55 p-1">
                        <ViewToggle
                          active={active.view === 'table'}
                          onClick={() => patch(active.id, { view: 'table' })}
                          icon={<FaTable size={11} />}
                          label="Table"
                        />
                        <ViewToggle
                          active={active.view === 'vertical'}
                          onClick={() => patch(active.id, { view: 'vertical' })}
                          icon={<FaColumns size={11} />}
                          label="Vertical"
                        />
                      </div>
                    </div>

                    {active.result.rows.length === 0 ? (
                      <EmptyState title="No rows returned" />
                    ) : active.view === 'table' ? (
                      <TableView result={active.result} />
                    ) : (
                      <VerticalView result={active.result} />
                    )}
                  </div>
                ) : null}
              </>
            ) : (
              <EmptyState
                icon={<FaDatabase />}
                title="No database selected"
                hint="Pick a project, environment, and database above to start querying in this tab."
              />
            )}
          </div>
        </div>
      </div>

      {saveMode && activeDb ? (
        <SaveQueryModal mode={saveMode} database={activeDb} sql={active.sql} onClose={() => setSaveMode(null)} />
      ) : null}
    </Card>
  )
}

function ViewToggle({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
        active ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white' : 'text-slate-600 hover:bg-white/75'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function TableView({ result }: { result: QueryResult }) {
  return (
    <div className="max-h-[55vh] overflow-auto rounded-xl border border-slate-200/60">
      <table className="w-full text-sm">
        <thead className="bg-white/50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {result.columns.map((c) => (
              <th key={c} className="whitespace-nowrap px-4 py-2.5 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200/50">
          {result.rows.map((row, i) => (
            <tr key={i} className="bg-white/30 hover:bg-white/60">
              {result.columns.map((c) => (
                <td key={c} className="whitespace-nowrap px-4 py-2 font-mono text-[13px] text-slate-700">
                  {row[c] === null ? <span className="text-slate-400 italic">NULL</span> : cellText(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Renders results like the MySQL CLI `\G` (vertical) output, inside a terminal.
function VerticalView({ result }: { result: QueryResult }) {
  const labelWidth = Math.max(...result.columns.map((c) => c.length))
  const separatorWidth = 27

  return (
    <div className="max-h-[55vh] overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-[13px] leading-relaxed shadow-inner">
      <div className="text-slate-400">
        mysql&gt; <span className="text-slate-200">SELECT ...\G</span>
      </div>
      {result.rows.map((row, i) => (
        <div key={i} className="mt-2">
          <div className="text-cyan-400">
            {'*'.repeat(separatorWidth)} {i + 1}. row {'*'.repeat(separatorWidth)}
          </div>
          {result.columns.map((c) => (
            <div key={c} className="whitespace-pre text-slate-100">
              <span className="text-emerald-400">{c.padStart(labelWidth)}</span>
              <span className="text-slate-500">: </span>
              {row[c] === null ? (
                <span className="text-slate-600 italic">NULL</span>
              ) : (
                <span className="text-amber-200">{cellText(row[c])}</span>
              )}
            </div>
          ))}
        </div>
      ))}
      <div className="mt-2 text-slate-500">
        {result.row_count} {result.row_count === 1 ? 'row' : 'rows'} in set ({(result.duration_ms / 1000).toFixed(3)} sec)
      </div>
    </div>
  )
}
