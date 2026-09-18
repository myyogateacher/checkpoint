import { useEffect, useState } from 'react'
import { FaCheckCircle, FaPlug, FaTimesCircle } from 'react-icons/fa'
import { api } from '../services/api'

type Status =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; latency: number }
  | { state: 'error'; message: string }

// Validates connection details against the live database via the backend, showing
// inline success (with latency) or the failure reason. Stale results are cleared
// whenever any field changes, so the badge always reflects the current inputs.
export function TestConnectionButton({
  engine,
  host,
  port,
  username,
  database,
  ssl,
  password,
  databaseId,
  mode,
}: {
  engine: string
  host: string
  port: number
  username: string
  database: string
  ssl: boolean
  password?: string
  databaseId?: string
  mode?: 'read' | 'write'
}) {
  const [status, setStatus] = useState<Status>({ state: 'idle' })

  useEffect(() => {
    setStatus({ state: 'idle' })
  }, [engine, host, port, username, database, ssl, password])

  const disabled = !host.trim() || !database.trim() || status.state === 'testing'

  async function test() {
    setStatus({ state: 'testing' })
    try {
      const res = await api.testConnection({ engine, host, port, username, database, ssl, password, database_id: databaseId, mode })
      if (res.ok) setStatus({ state: 'ok', latency: res.latency_ms ?? 0 })
      else setStatus({ state: 'error', message: res.error ?? 'Connection failed' })
    } catch (err) {
      setStatus({ state: 'error', message: err instanceof Error ? err.message : 'Connection failed' })
    }
  }

  return (
    <div className="flex items-start gap-2">
      <button
        type="button"
        onClick={test}
        disabled={disabled}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200/70 bg-white/50 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        <FaPlug size={10} /> {status.state === 'testing' ? 'Testing…' : 'Validate connection'}
      </button>
      {status.state === 'ok' ? (
        <span className="flex min-w-0 flex-1 items-center gap-1 text-xs font-medium text-emerald-600" role="status" aria-live="polite">
          <FaCheckCircle size={11} /> Connected ({status.latency} ms)
        </span>
      ) : null}
      {status.state === 'error' ? (
        <span className="flex min-w-0 flex-1 items-start gap-1 break-words text-xs font-medium leading-5 text-rose-600" role="status" aria-live="polite">
          <FaTimesCircle size={11} className="mt-1 shrink-0" /> <span>{status.message}</span>
        </span>
      ) : null}
    </div>
  )
}
