import { useEffect, useMemo, useState } from 'react'
import { FaDatabase } from 'react-icons/fa'
import { api } from '../services/api'
import type { Database, Environment, Project } from '../types'
import { ENGINE_LABELS } from '../lib/format'
import { PageHeader } from '../components/PageHeader'
import { EngineBadge } from '../components/badges'
import { ReadQueryPanel } from '../components/ReadQueryPanel'
import { Dropdown } from '../components/Dropdown'
import { Card, EmptyState, Field, Spinner } from '../components/ui'

export function QueryStudioPage() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [databases, setDatabases] = useState<Database[]>([])

  const [projectId, setProjectId] = useState('')
  const [environmentId, setEnvironmentId] = useState('')
  const [databaseId, setDatabaseId] = useState('')

  useEffect(() => {
    void (async () => {
      const [projs, envs, dbs] = await Promise.all([
        api.getProjects(),
        api.getAllEnvironments(),
        api.getDatabases(),
      ])
      setProjects(projs)
      setEnvironments(envs)
      setDatabases(dbs)
    })()
  }, [])

  const projectEnvs = useMemo(
    () => environments.filter((e) => e.project_id === projectId),
    [environments, projectId],
  )
  const envDatabases = useMemo(
    () => databases.filter((d) => d.environment_id === environmentId),
    [databases, environmentId],
  )
  const selectedDb = databases.find((d) => d.id === databaseId)

  function chooseProject(id: string) {
    setProjectId(id)
    setEnvironmentId('')
    setDatabaseId('')
  }
  function chooseEnvironment(id: string) {
    setEnvironmentId(id)
    setDatabaseId('')
  }

  if (projects === null) {
    return (
      <Card className="p-6">
        <Spinner label="Loading workspace…" />
      </Card>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Query Studio"
        title="Run a read query"
        description="Pick a project, environment, and database, then run read-only queries against its read connection."
      />

      <Card className="mb-4 p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Project">
            <Dropdown
              value={projectId}
              placeholder="Select project…"
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
              onChange={chooseProject}
            />
          </Field>
          <Field label="Environment">
            <Dropdown
              value={environmentId}
              placeholder={projectId ? 'Select environment…' : '—'}
              disabled={!projectId}
              options={projectEnvs.map((env) => ({ value: env.id, label: env.name }))}
              onChange={chooseEnvironment}
            />
          </Field>
          <Field label="Database">
            <Dropdown
              value={databaseId}
              placeholder={environmentId ? 'Select database…' : '—'}
              disabled={!environmentId}
              options={envDatabases.map((db) => ({ value: db.id, label: `${db.name} · ${ENGINE_LABELS[db.engine]}` }))}
              onChange={setDatabaseId}
            />
          </Field>
        </div>

        {selectedDb ? (
          <div className="mt-4 flex items-center gap-2 border-t border-slate-200/50 pt-3 text-sm text-slate-600">
            <FaDatabase className="text-slate-400" size={13} />
            <span className="font-mono">{selectedDb.name}</span>
            <EngineBadge engine={selectedDb.engine} />
            <span className="text-xs text-slate-400">{selectedDb.read_connection.host}</span>
          </div>
        ) : null}
      </Card>

      {selectedDb ? (
        <ReadQueryPanel key={selectedDb.id} database={selectedDb} />
      ) : (
        <EmptyState
          icon={<FaDatabase />}
          title="No database selected"
          hint="Choose a project, environment, and database above to start querying."
        />
      )}
    </>
  )
}
