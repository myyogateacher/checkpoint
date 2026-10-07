import { useLocation } from 'react-router-dom'
import { FaPlay } from 'react-icons/fa'
import { ReadQueryPanel } from '../components/ReadQueryPanel'
import { Card, EmptyState } from '../components/ui'
import { ENGINE_LABELS } from '../lib/format'
import { engineSupportsQuery } from '../lib/engines'
import { useDatabase } from './DatabaseLayout'

export function QueryPage() {
  const database = useDatabase()
  // A command handed over from the Schema tab's key browser.
  const handoff = (useLocation().state as { sql?: string } | null)?.sql
  if (!engineSupportsQuery(database.engine)) {
    return (
      <Card className="p-6">
        <EmptyState
          icon={<FaPlay />}
          title={`Read panel isn't available for ${ENGINE_LABELS[database.engine]}`}
          hint="This engine isn't queried with SQL, so the read panel doesn't apply."
        />
      </Card>
    )
  }
  return (
    <ReadQueryPanel
      key={handoff ?? ''}
      databases={[database]}
      fixedDatabaseId={database.id}
      initialQuery={handoff ? { databaseId: database.id, sql: handoff } : undefined}
    />
  )
}
