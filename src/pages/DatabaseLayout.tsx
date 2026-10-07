import { useEffect, useState } from 'react'
import { Outlet, useOutletContext, useParams } from 'react-router-dom'
import type { Database } from '../types'
import { api } from '../services/api'
import { ENGINE_LABELS, formatRows, relativeTime } from '../lib/format'
import { engineHasKeyspace } from '../lib/engines'
import { PageHeader } from '../components/PageHeader'
import { EngineBadge, TagList } from '../components/badges'
import { DatabaseTabs } from '../components/DatabaseTabs'
import { Card, Spinner } from '../components/ui'

type DbContext = { database: Database; refresh: () => void }

export function useDatabase(): Database {
  return useOutletContext<DbContext>().database
}

// Re-fetch the database (e.g. so the header's key/table count follows a sync).
export function useRefreshDatabase(): () => void {
  return useOutletContext<DbContext>().refresh
}

export function DatabaseLayout() {
  const { databaseId = '' } = useParams()
  const [database, setDatabase] = useState<Database | null | undefined>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [envName, setEnvName] = useState<string | null>(null)

  useEffect(() => {
    setDatabase(null)
    void api.getDatabase(databaseId).then((db) => {
      setDatabase(db ?? undefined)
      if (db) {
        void api.getProject(db.project_id).then((p) => setProjectName(p?.name ?? null))
        void api
          .getEnvironments(db.project_id)
          .then((envs) => setEnvName(envs.find((e) => e.id === db.environment_id)?.name ?? null))
      }
    })
  }, [databaseId])

  if (database === null) {
    return (
      <Card className="p-6">
        <Spinner label="Loading database…" />
      </Card>
    )
  }
  if (database === undefined) {
    return <PageHeader title="Database not found" />
  }

  return (
    <>
      <PageHeader
        eyebrow={ENGINE_LABELS[database.engine]}
        title={database.name}
        description={
          engineHasKeyspace(database.engine)
            ? database.key_count == null
              ? 'Keys not scanned yet'
              : `Keys scanned ${relativeTime(database.last_synced_at)} · ${formatRows(database.key_count)} keys`
            : `Last synced ${relativeTime(database.last_synced_at)} · ${database.table_count} tables`
        }
        breadcrumbs={[
          { label: 'Projects', to: '/projects' },
          ...(projectName ? [{ label: projectName, to: `/projects/${database.project_id}` }] : []),
          ...(envName ? [{ label: envName }] : []),
          { label: ENGINE_LABELS[database.engine] },
          { label: database.name },
        ]}
        actions={
          <div className="flex flex-col items-end gap-2">
            <EngineBadge engine={database.engine} />
            <TagList tags={database.tags} />
          </div>
        }
      />
      <DatabaseTabs databaseId={database.id} engine={database.engine} />
      <Outlet
        context={
          {
            database,
            refresh: () => void api.getDatabase(databaseId).then((db) => db && setDatabase(db)),
          } satisfies DbContext
        }
      />
    </>
  )
}
