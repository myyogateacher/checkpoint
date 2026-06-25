import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FaArrowLeft, FaGripVertical, FaPlus, FaTrash } from 'react-icons/fa'
import { api } from '../services/api'
import type { Database, Environment } from '../types'
import { ENGINE_LABELS } from '../lib/format'
import { notify } from '../lib/toast'
import { PageHeader } from '../components/PageHeader'
import { EngineBadge } from '../components/badges'
import { Dropdown } from '../components/Dropdown'
import { Button, Card, ErrorBanner, Field, Spinner, TextArea, TextInput } from '../components/ui'

interface QueryDraft {
  key: string
  sql: string
}

let counter = 0
function newQuery(sql = ''): QueryDraft {
  counter += 1
  return { key: `q_${counter}`, sql }
}

export function CreateMigrationPage() {
  // Three entry points: scoped to a single database, scoped to a project, or
  // global (from the Migrations page). The last two show a target-database
  // picker; project/global labels disambiguate same-named databases.
  const { databaseId, projectId } = useParams()
  const navigate = useNavigate()
  const [databases, setDatabases] = useState<Database[] | null>(null)
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [dbLabels, setDbLabels] = useState<Record<string, string>>({})
  const [selectedEnvId, setSelectedEnvId] = useState('')
  const [selectedDbId, setSelectedDbId] = useState<string>(databaseId ?? '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [queries, setQueries] = useState<QueryDraft[]>([newQuery()])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void (async () => {
      if (databaseId) {
        const db = await api.getDatabase(databaseId)
        setDatabases(db ? [db] : [])
        setSelectedDbId(databaseId)
        return
      }
      // Picker mode: load candidate databases plus project/environment names.
      // No default selection — the user picks environment then database.
      const [dbs, projects, envs] = await Promise.all([
        api.getDatabases(projectId),
        api.getProjects(),
        api.getAllEnvironments(),
      ])
      const projectName = Object.fromEntries(projects.map((p) => [p.id, p.name]))
      const labels: Record<string, string> = {}
      for (const env of envs) labels[env.id] = `${projectName[env.project_id] ?? ''} / ${env.name}`
      setDbLabels(labels)
      setEnvironments(envs)
      setDatabases(dbs)
    })()
  }, [databaseId, projectId])

  const activeDb = databases?.find((d) => d.id === selectedDbId)
  const showPicker = !databaseId
  // Project scope cascades environment → database; global scope is a flat list.
  const projectScoped = !databaseId && Boolean(projectId)
  const projectEnvs = useMemo(
    () => environments.filter((e) => e.project_id === projectId),
    [environments, projectId],
  )
  const pickerDatabases = useMemo(() => {
    if (!databases) return []
    return projectScoped ? databases.filter((d) => d.environment_id === selectedEnvId) : databases
  }, [databases, projectScoped, selectedEnvId])

  function updateQuery(key: string, sql: string) {
    setQueries((prev) => prev.map((q) => (q.key === key ? { ...q, sql } : q)))
  }
  function removeQuery(key: string) {
    setQueries((prev) => (prev.length === 1 ? prev : prev.filter((q) => q.key !== key)))
  }

  async function submit(mode: 'draft' | 'submit') {
    setError(null)
    if (!selectedDbId) return setError('Select a target database.')
    const cleaned = queries.map((q) => q.sql.trim()).filter(Boolean)
    if (!title.trim()) return setError('A title is required.')
    if (cleaned.length === 0) return setError('Add at least one query.')

    setSaving(true)
    try {
      const migration = await api.createMigration({
        database_id: selectedDbId,
        title: title.trim(),
        description: description.trim() || null,
        queries: cleaned,
        submit: mode === 'submit',
      })
      notify.success(mode === 'submit' ? 'Migration submitted for approval' : 'Migration saved as draft')
      navigate(`/migrations/${migration.id}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create migration'
      setError(msg)
      notify.error(msg)
    } finally {
      setSaving(false)
    }
  }

  if (databases === null) {
    return (
      <Card className="p-6">
        <Spinner label="Loading…" />
      </Card>
    )
  }
  if (databases.length === 0) return <PageHeader title="No databases available" />

  return (
    <>
      <button
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex cursor-pointer items-center gap-2 text-sm text-slate-500 hover:text-slate-700"
      >
        <FaArrowLeft size={11} /> Back
      </button>
      <PageHeader
        eyebrow="New migration"
        title={activeDb ? `Migration on ${activeDb.name}` : 'New migration'}
        description={activeDb ? ENGINE_LABELS[activeDb.engine] : undefined}
        actions={activeDb ? <EngineBadge engine={activeDb.engine} /> : null}
      />

      <div className="space-y-4">
        {showPicker ? (
          <Card className="p-5">
            <div className={projectScoped ? 'grid gap-3 sm:grid-cols-2' : ''}>
              {projectScoped ? (
                <Field label="Environment">
                  <Dropdown
                    value={selectedEnvId}
                    placeholder="Select environment…"
                    options={projectEnvs.map((env) => ({ value: env.id, label: env.name }))}
                    onChange={(v) => {
                      setSelectedEnvId(v)
                      setSelectedDbId('')
                    }}
                  />
                </Field>
              ) : null}
              <Field label="Target database" hint="The migration will run against this database.">
                <Dropdown
                  value={selectedDbId}
                  onChange={setSelectedDbId}
                  placeholder={projectScoped && !selectedEnvId ? 'Select an environment first' : 'Select database…'}
                  disabled={projectScoped && !selectedEnvId}
                  options={pickerDatabases.map((db) => ({
                    value: db.id,
                    label: `${db.name} (${ENGINE_LABELS[db.engine]})`,
                    hint: projectScoped ? undefined : dbLabels[db.environment_id] || undefined,
                  }))}
                />
              </Field>
            </div>
          </Card>
        ) : null}

        <Card className="space-y-4 p-5">
          <Field label="Title">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add last_seen_at to users" />
          </Field>
          <Field label="Description" hint="Optional — explain the intent for reviewers.">
            <TextArea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Why is this change needed?"
            />
          </Field>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Queries</h2>
            <span className="text-xs text-slate-500">Run in order, top to bottom.</span>
          </div>

          <div className="space-y-3">
            {queries.map((q, i) => (
              <div key={q.key} className="rounded-xl border border-slate-200/60 bg-white/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs font-medium text-slate-500">
                    <FaGripVertical className="text-slate-300" /> Statement {i + 1}
                  </span>
                  <button
                    onClick={() => removeQuery(q.key)}
                    disabled={queries.length === 1}
                    className="cursor-pointer rounded p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Remove statement"
                  >
                    <FaTrash size={11} />
                  </button>
                </div>
                <TextArea
                  rows={4}
                  value={q.sql}
                  spellCheck={false}
                  onChange={(e) => updateQuery(q.key, e.target.value)}
                  placeholder="ALTER TABLE ..."
                />
              </div>
            ))}
          </div>

          <button
            onClick={() => setQueries((prev) => [...prev, newQuery()])}
            className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300/70 px-3 py-2 text-sm text-slate-600 transition hover:bg-white/60"
          >
            <FaPlus size={11} /> Add statement
          </button>
        </Card>

        <ErrorBanner message={error} />

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => submit('draft')} loading={saving}>
            Save as draft
          </Button>
          <Button onClick={() => submit('submit')} loading={saving}>
            Submit for approval
          </Button>
        </div>
      </div>
    </>
  )
}
