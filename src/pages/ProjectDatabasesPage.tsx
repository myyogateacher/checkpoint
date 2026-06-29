import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FaDatabase, FaPlus, FaTable } from 'react-icons/fa'
import { api } from '../services/api'
import type { Database, Environment } from '../types'
import { useAuth } from '../context/AuthContext'
import { can, ENGINE_LABELS, relativeTime } from '../lib/format'
import { EngineBadge, TagList } from '../components/badges'
import { AddDatabaseModal } from '../components/AddDatabaseModal'
import { Button, Card, Spinner } from '../components/ui'
import { useProject } from './ProjectLayout'

const ENV_ACCENT: Record<string, string> = {
  rose: 'border-rose-200/70 bg-rose-50/60 text-rose-700 dark:border-rose-400/40 dark:bg-rose-500/25 dark:text-rose-200',
  amber: 'border-amber-200/70 bg-amber-50/60 text-amber-700 dark:border-amber-400/40 dark:bg-amber-500/25 dark:text-amber-200',
  emerald: 'border-emerald-200/70 bg-emerald-50/60 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/25 dark:text-emerald-200',
}

export function ProjectDatabasesPage() {
  const project = useProject()
  const { user } = useAuth()
  const [environments, setEnvironments] = useState<Environment[] | null>(null)
  const [databases, setDatabases] = useState<Database[]>([])
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => {
    void (async () => {
      const [envs, dbs] = await Promise.all([api.getEnvironments(project.id), api.getDatabases(project.id)])
      setEnvironments(envs)
      setDatabases(dbs)
    })()
  }, [project.id])

  const dbsByEnv = useMemo(() => {
    const map: Record<string, Database[]> = {}
    for (const d of databases) (map[d.environment_id] ??= []).push(d)
    return map
  }, [databases])

  if (environments === null) {
    return (
      <Card className="p-6">
        <Spinner label="Loading databases…" />
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {can(user?.role, 'edit') ? (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => setShowAdd(true)}>
            <FaPlus size={12} /> Add database
          </Button>
        </div>
      ) : null}

      {showAdd && environments ? (
        <AddDatabaseModal
          projectId={project.id}
          environments={environments}
          onClose={() => setShowAdd(false)}
          onCreated={(db, newEnvironment) => {
            if (newEnvironment) {
              setEnvironments((prev) => (prev ? [...prev, newEnvironment] : [newEnvironment]))
            }
            setDatabases((prev) => [...prev, db])
            setShowAdd(false)
          }}
        />
      ) : null}

      {environments.map((env) => (
        <Card key={env.id} className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold capitalize ${
                ENV_ACCENT[env.color] ?? ENV_ACCENT.emerald
              }`}
            >
              {env.name}
            </span>
            <span className="text-xs text-slate-500">{(dbsByEnv[env.id] ?? []).length} databases</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {(dbsByEnv[env.id] ?? []).map((db) => (
              <Link key={db.id} to={`/databases/${db.id}/schema`}>
                <div className="glass-panel h-full rounded-xl p-4 transition hover:-translate-y-0.5 hover:shadow-md">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-mono text-sm font-medium text-slate-800">
                      <FaDatabase className="text-slate-400" size={13} />
                      {db.name}
                    </div>
                    <EngineBadge engine={db.engine} />
                  </div>
                  <p className="mt-3 text-xs text-slate-500">{ENGINE_LABELS[db.engine]}</p>
                  <TagList tags={db.tags} className="mt-2" />
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                    <span className="flex items-center gap-1.5">
                      <FaTable size={10} className="text-slate-400" /> {db.table_count} tables
                    </span>
                    <span>synced {relativeTime(db.last_synced_at)}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}
