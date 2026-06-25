import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FaPlus } from 'react-icons/fa'
import { api } from '../services/api'
import type { Migration } from '../types'
import { useAuth } from '../context/AuthContext'
import { can } from '../lib/format'
import { Button, Card, Spinner } from '../components/ui'
import { MigrationTable } from '../components/MigrationTable'
import { useProject } from './ProjectLayout'

export function ProjectMigrationsPage() {
  const project = useProject()
  const { user } = useAuth()
  const [migrations, setMigrations] = useState<Migration[] | null>(null)

  useEffect(() => {
    setMigrations(null)
    void api.getProjectMigrations(project.id).then(setMigrations)
  }, [project.id])

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Migrations in this project</h2>
          <p className="text-xs text-slate-500">Across every database in {project.name}.</p>
        </div>
        {can(user?.role, 'edit') ? (
          <Link to={`/projects/${project.id}/migrations/new`}>
            <Button>
              <FaPlus size={12} /> New migration
            </Button>
          </Link>
        ) : null}
      </div>
      {migrations === null ? <Spinner /> : <MigrationTable migrations={migrations} />}
    </Card>
  )
}
