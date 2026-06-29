import { FaPlay } from 'react-icons/fa'
import { ReadQueryPanel } from '../components/ReadQueryPanel'
import { Card, EmptyState } from '../components/ui'
import { ENGINE_LABELS } from '../lib/format'
import { engineSupportsQuery } from '../lib/engines'
import { useDatabase } from './DatabaseLayout'

export function QueryPage() {
  const database = useDatabase()
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
  return <ReadQueryPanel databases={[database]} fixedDatabaseId={database.id} />
}
