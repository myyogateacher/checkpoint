import { useCallback, useEffect, useState } from 'react'
import { FaChevronDown, FaChevronRight, FaKey, FaSync, FaTable } from 'react-icons/fa'
import { api } from '../services/api'
import type { SchemaSnapshot, TableDef } from '../types'
import { useAuth } from '../context/AuthContext'
import { can, formatRows, relativeTime } from '../lib/format'
import { notify } from '../lib/toast'
import { Button, Card, EmptyState, Spinner } from '../components/ui'
import { useDatabase } from './DatabaseLayout'

export function SchemaPage() {
  const database = useDatabase()
  const { user } = useAuth()
  const [schema, setSchema] = useState<SchemaSnapshot | null | undefined>(null)
  const [syncing, setSyncing] = useState(false)
  const [openTable, setOpenTable] = useState<string | null>(null)

  const load = useCallback(() => {
    setSchema(null)
    void api.getSchema(database.id).then((s) => {
      setSchema(s ?? undefined)
      setOpenTable(s?.tables[0]?.name ?? null)
    })
  }, [database.id])

  useEffect(load, [load])

  async function handleSync() {
    setSyncing(true)
    try {
      const s = await api.syncSchema(database.id)
      setSchema(s ?? undefined)
      notify.success(`Schema pulled — ${s?.tables.length ?? 0} tables`)
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to pull schema')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Current schema</h2>
          <p className="text-xs text-slate-500">
            {schema ? `Snapshot from ${relativeTime(schema.synced_at)} · pulled via read connection` : 'Loading…'}
          </p>
        </div>
        {can(user?.role, 'edit') ? (
          <Button variant="secondary" onClick={handleSync} loading={syncing}>
            {!syncing ? <FaSync size={12} /> : null} Pull schema
          </Button>
        ) : null}
      </div>

      {schema === null ? (
        <Spinner label="Loading schema…" />
      ) : schema === undefined || schema.tables.length === 0 ? (
        <EmptyState
          icon={<FaTable />}
          title="No schema snapshot"
          hint="Pull the schema from the database to populate tables and structure."
        />
      ) : (
        <div className="space-y-2">
          {schema.tables.map((table) => (
            <TableRow
              key={table.name}
              table={table}
              open={openTable === table.name}
              onToggle={() => setOpenTable((prev) => (prev === table.name ? null : table.name))}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

function TableRow({ table, open, onToggle }: { table: TableDef; open: boolean; onToggle: () => void }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/60 bg-white/40">
      <button
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition hover:bg-white/60"
      >
        <span className="text-slate-400">{open ? <FaChevronDown size={11} /> : <FaChevronRight size={11} />}</span>
        <FaTable className="text-indigo-400" size={13} />
        <span className="font-mono text-sm font-medium text-slate-800">
          {table.schema}.{table.name}
        </span>
        <span className="ml-auto text-xs text-slate-500">
          {table.columns.length} cols · ~{formatRows(table.estimated_rows)} rows
        </span>
      </button>

      {open ? (
        <div className="border-t border-slate-200/60 px-4 py-3">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-1.5 font-medium">Column</th>
                <th className="py-1.5 font-medium">Type</th>
                <th className="py-1.5 font-medium">Nullable</th>
                <th className="py-1.5 font-medium">Default</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/40">
              {table.columns.map((col) => (
                <tr key={col.name}>
                  <td className="py-1.5 font-mono text-[13px] text-slate-800">
                    <span className="inline-flex items-center gap-1.5">
                      {col.is_primary_key ? <FaKey size={9} className="text-amber-500" title="Primary key" /> : null}
                      {col.name}
                    </span>
                  </td>
                  <td className="py-1.5 font-mono text-[13px] text-sky-700">{col.data_type}</td>
                  <td className="py-1.5 text-xs text-slate-500">{col.nullable ? 'NULL' : 'NOT NULL'}</td>
                  <td className="py-1.5 font-mono text-[12px] text-slate-500">{col.default ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {table.indexes.length > 0 ? (
            <div className="mt-3 border-t border-slate-200/40 pt-3">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Indexes</p>
              <div className="flex flex-wrap gap-2">
                {table.indexes.map((idx) => (
                  <span
                    key={idx.name}
                    className="rounded-md border border-slate-200/70 bg-white/60 px-2 py-1 font-mono text-[12px] text-slate-600"
                  >
                    {idx.unique ? 'UNIQUE ' : ''}
                    {idx.name} ({idx.columns.join(', ')})
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
