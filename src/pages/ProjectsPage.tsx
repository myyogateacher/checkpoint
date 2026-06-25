import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FaDatabase, FaFolder, FaLayerGroup, FaPlus } from 'react-icons/fa'
import { api } from '../services/api'
import type { Project } from '../types'
import { useAuth } from '../context/AuthContext'
import { can, formatDate } from '../lib/format'
import { notify } from '../lib/toast'
import { PageHeader } from '../components/PageHeader'
import { TagList } from '../components/badges'
import { Button, Card, EmptyState, Field, Modal, Spinner, TextArea, TextInput } from '../components/ui'

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
}

export function ProjectsPage() {
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')

  useEffect(() => {
    void api.getProjects().then(setProjects)
  }, [])

  function handleCreate() {
    // Stub: optimistically add to the list. The real backend persists this.
    const project: Project = {
      id: `p_${Date.now()}`,
      name,
      description: description || null,
      tags: parseTags(tags),
      created_at: new Date().toISOString(),
      environment_count: 0,
      database_count: 0,
    }
    setProjects((prev) => [...(prev ?? []), project])
    setShowCreate(false)
    setName('')
    setDescription('')
    setTags('')
    notify.success(`Project “${project.name}” created`)
  }

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Projects"
        description="Each project groups its environments and databases. Pick a database to browse its schema, run read queries, or open a migration."
        actions={
          can(user?.role, 'edit') ? (
            <Button onClick={() => setShowCreate(true)}>
              <FaPlus size={12} /> New project
            </Button>
          ) : null
        }
      />

      {projects === null ? (
        <Card className="p-6">
          <Spinner label="Loading projects…" />
        </Card>
      ) : projects.length === 0 ? (
        <EmptyState icon={<FaFolder />} title="No projects yet" hint="Create a project to get started." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <Link key={project.id} to={`/projects/${project.id}`}>
              <Card className="h-full p-5 transition hover:-translate-y-0.5 hover:shadow-lg">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50/80 text-indigo-500">
                    <FaFolder />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{project.name}</p>
                    <p className="text-xs text-slate-500">Created {formatDate(project.created_at)}</p>
                  </div>
                </div>
                {project.description ? (
                  <p className="mt-3 line-clamp-2 text-sm text-slate-600">{project.description}</p>
                ) : null}
                <TagList tags={project.tags} className="mt-3" />
                <div className="mt-4 flex gap-4 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <FaLayerGroup className="text-slate-400" /> {project.environment_count} environments
                  </span>
                  <span className="flex items-center gap-1.5">
                    <FaDatabase className="text-slate-400" /> {project.database_count} databases
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Modal
        open={showCreate}
        title="New project"
        onClose={() => setShowCreate(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!name.trim()}>
              Create project
            </Button>
          </>
        }
      >
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Core Platform" />
        </Field>
        <Field label="Description" hint="Optional">
          <TextArea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What lives in this project?"
          />
        </Field>
        <Field label="Tags" hint="Comma-separated, e.g. production, pii, tier-1">
          <TextInput value={tags} onChange={(e) => setTags(e.target.value)} placeholder="production, pii" />
        </Field>
      </Modal>
    </>
  )
}
