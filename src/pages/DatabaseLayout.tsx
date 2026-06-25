import { useEffect, useState } from 'react'
import { Outlet, useOutletContext, useParams } from 'react-router-dom'
import type { Database } from '../types'
import { api } from '../services/api'
import { ENGINE_LABELS, relativeTime } from '../lib/format'
import { PageHeader } from '../components/PageHeader'
import { EngineBadge, TagList } from '../components/badges'
import { DatabaseTabs } from '../components/DatabaseTabs'
import { Card, Spinner } from '../components/ui'

type DbContext = { database: Database }

export function useDatabase(): Database {
  return useOutletContext<DbContext>().database
}

export function DatabaseLayout() {
  const { databaseId = '' } = useParams()
  const [database, setDatabase] = useState<Database | null | undefined>(null)
  const [projectName, setProjectName] = useState<string | null>(null)

  useEffect(() => {
    setDatabase(null)
    void api.getDatabase(databaseId).then((db) => {
      setDatabase(db ?? undefined)
      if (db) void api.getProject(db.project_id).then((p) => setProjectName(p?.name ?? null))
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
        description={`Last synced ${relativeTime(database.last_synced_at)} · ${database.table_count} tables`}
        breadcrumbs={[
          { label: 'Projects', to: '/' },
          ...(projectName ? [{ label: projectName, to: `/projects/${database.project_id}` }] : []),
          { label: database.name },
        ]}
        actions={
          <div className="flex flex-col items-end gap-2">
            <EngineBadge engine={database.engine} />
            <TagList tags={database.tags} />
          </div>
        }
      />
      <DatabaseTabs databaseId={database.id} />
      <Outlet context={{ database } satisfies DbContext} />
    </>
  )
}
