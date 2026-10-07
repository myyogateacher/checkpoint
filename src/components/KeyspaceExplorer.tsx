import { useEffect, useState } from 'react'
import { FaSearch, FaSync } from 'react-icons/fa'
import { api } from '../services/api'
import type { Database, KeyLeaf, SchemaSnapshot } from '../types'
import { useAuth } from '../context/AuthContext'
import { can, formatRows, relativeTime } from '../lib/format'
import { notify } from '../lib/toast'
import { KeyspaceTree } from './KeyspaceTree'

// Query-panel side pane for Redis: the stored keyspace snapshot as folders, with
// a manual rescan (scans walk every key, so they never run on their own).
export function KeyspaceExplorer({ database, onPickKey }: { database: Database; onPickKey: (leaf: KeyLeaf) => void }) {
  const { user } = useAuth()
  const [snapshot, setSnapshot] = useState<SchemaSnapshot | null | undefined>(null)
  const [scanning, setScanning] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    setSnapshot(null)
    void api.getSchema(database.id).then((s) => setSnapshot(s ?? undefined))
  }, [database.id])

  async function scan() {
    setScanning(true)
    try {
      const s = await api.syncSchema(database.id)
      setSnapshot(s ?? undefined)
      notify.success(`Scanned ${formatRows(s?.keyspace?.total_keys ?? 0)} keys`)
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to scan keys')
    } finally {
      setScanning(false)
    }
  }

  const keyspace = snapshot?.keyspace
  const canScan = can(user?.role, 'edit')

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-1.5 border-b border-slate-200/60 p-2">
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <FaSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={11} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search keys"
              disabled={!keyspace}
              className="w-full rounded-lg border py-1.5 pl-7 pr-2 text-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200/60 disabled:opacity-50"
            />
          </div>
          {canScan ? (
            <button
              onClick={scan}
              disabled={scanning}
              title={keyspace ? 'Rescan keys' : 'Scan keys'}
              aria-label={keyspace ? 'Rescan keys' : 'Scan keys'}
              className="shrink-0 rounded-lg border border-slate-200/70 bg-white/50 p-2 text-slate-500 transition hover:bg-white/60 disabled:opacity-50"
            >
              <FaSync size={10} className={scanning ? 'animate-spin' : ''} />
            </button>
          ) : null}
        </div>
        {keyspace ? (
          <p className="px-0.5 text-[11px] text-slate-400">
            {formatRows(keyspace.total_keys)} keys · scanned {relativeTime(snapshot!.synced_at)}
            {keyspace.truncated ? ' · partial' : ''}
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 text-sm">
        {snapshot === null ? (
          <p className="px-1 py-2 text-xs text-slate-400">Loading…</p>
        ) : !keyspace ? (
          <p className="px-1 py-2 text-xs text-slate-500">
            {scanning
              ? 'Scanning keys…'
              : canScan
                ? 'Keys haven’t been scanned yet. Use the refresh button to scan them into folders.'
                : 'Keys haven’t been scanned yet. Ask an editor to scan them from the Schema tab.'}
          </p>
        ) : (
          <KeyspaceTree keyspace={keyspace} query={query} compact onPickKey={onPickKey} />
        )}
      </div>
    </div>
  )
}
