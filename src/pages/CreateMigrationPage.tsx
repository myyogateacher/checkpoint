import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FaArrowLeft, FaGripVertical, FaPlus, FaTrash } from 'react-icons/fa'
import { api } from '../services/api'
import { useOrg } from '../context/OrgContext'
import type { Database, Environment } from '../types'
import { ENGINE_LABELS } from '../lib/format'
import { engineSupportsMigrations } from '../lib/engines'
import { prevalidateMigration, prevalidateStatement, type Violation } from '../lib/validationRules'
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
  const { currentOrgId } = useOrg()
  const [databases, setDatabases] = useState<Database[] | null>(null)
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [dbLabels, setDbLabels] = useState<Record<string, string>>({})
  const [selectedEnvId, setSelectedEnvId] = useState('')
  const [selectedDbId, setSelectedDbId] = useState<string>(databaseId ?? '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [queries, setQueries] = useState<QueryDraft[]>([newQuery()])
  // Validation: per-statement violations keyed by query, plus migration-level ones.
  const [stmtViolations, setStmtViolations] = useState<Record<string, Violation[]>>({})
  const [migrationViolations, setMigrationViolations] = useState<Violation[]>([])
  const [hasViolations, setHasViolations] = useState(false)
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
      // Project-scoped picker filters by projectId; global picker by org.
      const [dbs, projects, envs] = await Promise.all([
        api.getDatabases(projectId, projectId ? undefined : currentOrgId ?? undefined),
        api.getProjects(projectId ? undefined : currentOrgId ?? undefined),
        api.getAllEnvironments(),
      ])
      const projectName = Object.fromEntries(projects.map((p) => [p.id, p.name]))
      const labels: Record<string, string> = {}
      for (const env of envs) labels[env.id] = `${projectName[env.project_id] ?? ''} / ${env.name}`
      setDbLabels(labels)
      setEnvironments(envs)
      setDatabases(dbs)
    })()
  }, [databaseId, projectId, currentOrgId])

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
    // Only engines that support reviewed DDL migrations can be targeted.
    const migratable = databases.filter((d) => engineSupportsMigrations(d.engine))
    return projectScoped ? migratable.filter((d) => d.environment_id === selectedEnvId) : migratable
  }, [databases, projectScoped, selectedEnvId])

  function updateQuery(key: string, sql: string) {
    setQueries((prev) => prev.map((q) => (q.key === key ? { ...q, sql } : q)))
    // Clear this statement's violations as the user edits it.
    setStmtViolations((prev) => (prev[key] ? { ...prev, [key]: [] } : prev))
  }
  function removeQuery(key: string) {
    setQueries((prev) => (prev.length === 1 ? prev : prev.filter((q) => q.key !== key)))
  }

  async function submit(mode: 'draft' | 'submit') {
    setError(null)
    setStmtViolations({})
    setMigrationViolations([])
    setHasViolations(false)
    if (!selectedDbId) return setError('Select a target database.')
    const filled = queries.filter((q) => q.sql.trim())
    if (!title.trim()) return setError('A title is required.')
    if (filled.length === 0) return setError('Add at least one query.')

    // Pre-validate against the target engine's enabled rules: per-statement
    // violations are attached to each statement, aggregate ones to the migration.
    if (activeDb) {
      const sections = await api.getValidationRules(activeDb.engine)
      const perStmt: Record<string, Violation[]> = {}
      let any = false
      for (const q of filled) {
        const v = prevalidateStatement(q.sql.trim(), sections)
        if (v.length) {
          perStmt[q.key] = v
          any = true
        }
      }
      const combinedSql = filled.map((q) => (q.sql.trim().endsWith(';') ? q.sql.trim() : `${q.sql.trim()};`)).join('\n')
      const migLevel = prevalidateMigration(combinedSql, sections)
      if (any || migLevel.length) {
        setStmtViolations(perStmt)
        setMigrationViolations(migLevel)
        setHasViolations(true)
        return
      }
    }

    const cleaned = filled.map((q) => q.sql.trim())
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
                {stmtViolations[q.key]?.length ? (
                  <ul className="mt-2 space-y-1 rounded-lg border border-rose-200/80 bg-rose-50/80 px-3 py-2 dark:border-rose-500/40 dark:bg-rose-500/20">
                    {stmtViolations[q.key].map((v, vi) => (
                      <li key={vi} className="flex gap-2 text-xs text-rose-700 dark:text-rose-200">
                        <span className="font-semibold">{v.ruleTitle}:</span>
                        <span className="text-rose-600 dark:text-rose-300">{v.message}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>

          <button
            onClick={() => setQueries((prev) => [...prev, newQuery()])}
            className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300/70 px-3 py-2 text-sm text-slate-600 transition hover:bg-white/60"
          >
            <FaPlus size={11} /> Add statement
          </button>

          {hasViolations ? (
            <div className="mt-4 rounded-lg border border-rose-200/80 bg-rose-50/80 px-4 py-3 dark:border-rose-500/40 dark:bg-rose-500/20">
              <p className="text-sm font-medium text-rose-700 dark:text-rose-200">
                This migration violates validation rules. Fix the issues below each statement, or adjust the rules.
              </p>
              {migrationViolations.length ? (
                <ul className="mt-2 space-y-1">
                  {migrationViolations.map((v, i) => (
                    <li key={i} className="flex gap-2 text-sm text-rose-700 dark:text-rose-200">
                      <span className="font-semibold">{v.ruleTitle}:</span>
                      <span className="text-rose-600 dark:text-rose-300">{v.message}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
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
