import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FaPlus } from 'react-icons/fa'
import { api } from '../services/api'
import type { Migration } from '../types'
import { useAuth } from '../context/AuthContext'
import { can } from '../lib/format'
import { Button, Card, Spinner } from '../components/ui'
import { MigrationTable } from '../components/MigrationTable'
import { useDatabase } from './DatabaseLayout'

export function DatabaseMigrationsPage() {
  const database = useDatabase()
  const { user } = useAuth()
  const [migrations, setMigrations] = useState<Migration[] | null>(null)

  useEffect(() => {
    setMigrations(null)
    void api.getMigrations(database.id).then(setMigrations)
  }, [database.id])

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">Migrations for this database</h2>
        {can(user?.role, 'edit') ? (
          <Link to={`/databases/${database.id}/migrations/new`}>
            <Button>
              <FaPlus size={12} /> New migration
            </Button>
          </Link>
        ) : null}
      </div>
      {migrations === null ? <Spinner /> : <MigrationTable migrations={migrations} showDatabase={false} />}
    </Card>
  )
}
