import { ReadQueryPanel } from '../components/ReadQueryPanel'
import { useDatabase } from './DatabaseLayout'

export function QueryPage() {
  const database = useDatabase()
  return <ReadQueryPanel database={database} />
}
