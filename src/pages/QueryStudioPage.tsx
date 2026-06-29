import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../services/api'
import { useOrg } from '../context/OrgContext'
import type { Database, Environment, Project, SavedQuery } from '../types'
import { PageHeader } from '../components/PageHeader'
import { ReadQueryPanel } from '../components/ReadQueryPanel'
import { Card, Spinner } from '../components/ui'

export function QueryStudioPage() {
  const [searchParams] = useSearchParams()
  const savedId = searchParams.get('saved')
  const { currentOrgId } = useOrg()

  const [projects, setProjects] = useState<Project[] | null>(null)
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [databases, setDatabases] = useState<Database[]>([])
  const [saved, setSaved] = useState<SavedQuery | null>(null)
  const [savedLoading, setSavedLoading] = useState(false)

  useEffect(() => {
    void (async () => {
      const [projs, envs, dbs] = await Promise.all([
        api.getProjects(currentOrgId ?? undefined),
        api.getAllEnvironments(),
        api.getDatabases(undefined, currentOrgId ?? undefined),
      ])
      setProjects(projs)
      setEnvironments(envs)
      setDatabases(dbs)
    })()
  }, [currentOrgId])

  useEffect(() => {
    if (!savedId) {
      setSaved(null)
      return
    }
    setSavedLoading(true)
    void api.getSavedQuery(savedId).then((q) => {
      setSaved(q ?? null)
      setSavedLoading(false)
    })
  }, [savedId])

  const ready = projects !== null && !(savedId && savedLoading)

  return (
    <>
      <PageHeader
        eyebrow="Query Studio"
        title="Run a read query"
        description="Open a tab, pick its project / environment / database, and run read-only queries. Each tab keeps its own database and query."
      />

      {!ready ? (
        <Card className="p-6">
          <Spinner label="Loading workspace…" />
        </Card>
      ) : (
        <ReadQueryPanel
          // Remount when a different saved query is opened so it seeds the tab.
          key={savedId ?? 'studio'}
          databases={databases}
          projects={projects ?? []}
          environments={environments}
          initialQuery={saved ? { databaseId: saved.database_id, sql: saved.sql, name: saved.name } : undefined}
        />
      )}
    </>
  )
}
