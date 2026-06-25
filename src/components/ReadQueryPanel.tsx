import { useState } from 'react'
import { FaColumns, FaPlay, FaTable } from 'react-icons/fa'
import { api } from '../services/api'
import type { Database, QueryResult } from '../types'
import { ConnectionBadge } from './badges'
import { Button, Card, EmptyState, ErrorBanner, TextArea } from './ui'

type ViewMode = 'table' | 'vertical'

// The read-only query workspace for a single database. Shared by the database
// "Read panel" tab and the standalone Query Studio.
export function ReadQueryPanel({ database }: { database: Database }) {
  const [sql, setSql] = useState('SELECT * FROM users LIMIT 50;')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [view, setView] = useState<ViewMode>('table')

  async function run() {
    setRunning(true)
    setError(null)
    try {
      const res = await api.runReadQuery(database.id, sql)
      setResult(res)
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : 'Query failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-800">Read panel</h2>
            <ConnectionBadge mode="read" />
          </div>
          <p className="text-xs text-slate-500">
            Read-only — runs on <span className="font-mono">{database.read_connection.host}</span>. Only
            SELECT / SHOW / WITH / EXPLAIN are permitted.
          </p>
        </div>

        <TextArea
          rows={6}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          spellCheck={false}
          placeholder="SELECT ..."
        />

        <div className="mt-3 flex items-center gap-2">
          <Button onClick={run} loading={running}>
            {!running ? <FaPlay size={11} /> : null} Run query
          </Button>
          {result ? (
            <span className="text-xs text-slate-500">
              {result.row_count} rows · {result.duration_ms} ms
            </span>
          ) : null}
        </div>

        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      </Card>

      {result ? (
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Result</h3>
            <div className="flex gap-1 rounded-full border border-white/60 bg-white/55 p-1">
              <ViewToggle active={view === 'table'} onClick={() => setView('table')} icon={<FaTable size={11} />} label="Table" />
              <ViewToggle
                active={view === 'vertical'}
                onClick={() => setView('vertical')}
                icon={<FaColumns size={11} />}
                label="Vertical"
              />
            </div>
          </div>

          {result.rows.length === 0 ? (
            <EmptyState title="No rows returned" />
          ) : view === 'table' ? (
            <TableView result={result} />
          ) : (
            <VerticalView result={result} />
          )}
        </Card>
      ) : null}
    </div>
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
    <div className="overflow-x-auto rounded-xl border border-slate-200/60">
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
    <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-[13px] leading-relaxed shadow-inner">
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
