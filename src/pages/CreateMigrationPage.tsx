import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FaArrowLeft, FaGripVertical, FaPlus, FaTimes, FaTrash } from 'react-icons/fa'
import { api } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useOrg } from '../context/OrgContext'
import type { Database, Environment, ManagedUser, Migration } from '../types'
import { ENGINE_LABELS } from '../lib/format'
import { engineSupportsMigrations } from '../lib/engines'
import { prevalidateMigration, prevalidateStatement, type Violation } from '../lib/validationRules'
import { checkSyntax } from '../lib/sqlSyntax'
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
  // With :migrationId the page runs in edit mode over an existing draft.
  const { databaseId, projectId, migrationId } = useParams()
  const editMode = Boolean(migrationId)
  const navigate = useNavigate()
  const { user } = useAuth()
  const { currentOrgId } = useOrg()
  const [databases, setDatabases] = useState<Database[] | null>(null)
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [dbLabels, setDbLabels] = useState<Record<string, string>>({})
  const [selectedEnvId, setSelectedEnvId] = useState('')
  const [selectedDbId, setSelectedDbId] = useState<string>(databaseId ?? '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [reviewers, setReviewers] = useState<string[]>([])
  const [deployGated, setDeployGated] = useState(false)
  const [queries, setQueries] = useState<QueryDraft[]>([newQuery()])
  // Validation: per-statement violations keyed by query, plus migration-level ones.
  const [stmtViolations, setStmtViolations] = useState<Record<string, Violation[]>>({})
  const [migrationViolations, setMigrationViolations] = useState<Violation[]>([])
  const [hasViolations, setHasViolations] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Edit mode: the loaded migration plus its reviewers at load time, so we only
  // re-send reviewers when they actually changed.
  const [migration, setMigration] = useState<Migration | null>(null)
  const [initialReviewers, setInitialReviewers] = useState<string[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    void api.getUsers().then(setUsers)
  }, [])

  useEffect(() => {
    void (async () => {
      if (migrationId) {
        const mig = await api.getMigration(migrationId)
        if (!mig) {
          setLoadError('Migration not found.')
          setDatabases([])
          return
        }
        const db = await api.getDatabase(mig.database_id)
        setMigration(mig)
        setDatabases(db ? [db] : [])
        setSelectedDbId(mig.database_id)
        setTitle(mig.title)
        setDescription(mig.description ?? '')
        setDeployGated(mig.deploy_gated)
        setReviewers(mig.reviewers)
        setInitialReviewers(mig.reviewers)
        setQueries(
          mig.queries.length
            ? [...mig.queries].sort((a, b) => a.order - b.order).map((q) => newQuery(q.sql))
            : [newQuery()],
        )
        if (mig.status !== 'draft') setLoadError('This migration is no longer a draft and can no longer be edited.')
        return
      }
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
  }, [migrationId, databaseId, projectId, currentOrgId])

  const activeDb = databases?.find((d) => d.id === selectedDbId)
  const showPicker = !databaseId && !editMode
  const locked = editMode && (Boolean(loadError) || migration?.status !== 'draft')
  // Project scope cascades environment → database; global scope is a flat list.
  const projectScoped = !databaseId && !editMode && Boolean(projectId)
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
    if (locked) return
    if (!selectedDbId) return setError('Select a target database.')
    const filled = queries.filter((q) => q.sql.trim())
    if (!title.trim()) return setError('A title is required.')
    if (filled.length === 0) return setError('Add at least one query.')

    // Pre-validate against the target engine's enabled rules: per-statement
    // violations are attached to each statement, aggregate ones to the migration.
    // Syntax is checked first, alongside the rules, per statement.
    if (activeDb) {
      const sections = await api.getValidationRules(activeDb.engine)
      const perStmt: Record<string, Violation[]> = {}
      let any = false
      for (const q of filled) {
        const v: Violation[] = []
        const syntaxError = checkSyntax(q.sql.trim(), activeDb.engine)
        if (syntaxError) v.push({ ruleId: 'syntax', ruleTitle: 'SQL syntax', message: syntaxError })
        v.push(...prevalidateStatement(q.sql.trim(), sections))
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
      if (editMode && migrationId) {
        await api.updateMigration(migrationId, {
          title: title.trim(),
          description: description.trim() || null,
          queries: cleaned,
          deploy_gated: deployGated,
        })
        const changed =
          reviewers.length !== initialReviewers.length || reviewers.some((r) => !initialReviewers.includes(r))
        if (changed) await api.setMigrationReviewers(migrationId, reviewers)
        if (mode === 'submit') await api.transitionMigration(migrationId, 'submit')
        notify.success(mode === 'submit' ? 'Migration submitted for approval' : 'Changes saved')
        navigate(`/migrations/${migrationId}`)
        return
      }
      const created = await api.createMigration({
        database_id: selectedDbId,
        title: title.trim(),
        description: description.trim() || null,
        queries: cleaned,
        submit: mode === 'submit',
        deploy_gated: deployGated,
        reviewers,
      })
      notify.success(mode === 'submit' ? 'Migration submitted for approval' : 'Migration saved as draft')
      navigate(`/migrations/${created.id}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : editMode ? 'Failed to save migration' : 'Failed to create migration'
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
        eyebrow={editMode ? 'Edit migration' : 'New migration'}
        title={
          editMode
            ? activeDb
              ? `Edit migration on ${activeDb.name}`
              : 'Edit migration'
            : activeDb
              ? `Migration on ${activeDb.name}`
              : 'New migration'
        }
        description={activeDb ? ENGINE_LABELS[activeDb.engine] : undefined}
        actions={activeDb ? <EngineBadge engine={activeDb.engine} /> : null}
      />

      <div className="space-y-4">
        <ErrorBanner message={loadError} />

        {editMode && activeDb ? (
          <Card className="p-5">
            <Field label="Target database" hint="The target database can't be changed after the migration is created.">
              <div className="flex items-center gap-2 rounded-lg border border-slate-200/60 bg-white/40 px-3 py-2 text-sm text-slate-700">
                {activeDb.name}
                <span className="text-xs text-slate-500">{ENGINE_LABELS[activeDb.engine]}</span>
              </div>
            </Field>
          </Card>
        ) : null}

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
          <Field label="Reviewers" hint="Optional — tagged in the Slack notification on submit.">
            {reviewers.length ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {reviewers.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/70 bg-white/60 px-2.5 py-1 text-xs text-slate-700"
                  >
                    {email}
                    <button
                      onClick={() => setReviewers((prev) => prev.filter((r) => r !== email))}
                      className="cursor-pointer text-slate-400 transition hover:text-rose-600"
                      title="Remove reviewer"
                    >
                      <FaTimes size={10} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <Dropdown
              value=""
              placeholder="Add reviewer…"
              onChange={(email) => setReviewers((prev) => [...prev, email])}
              options={users
                .filter((u) => u.email !== user?.email && !reviewers.includes(u.email))
                .map((u) => ({ value: u.email, label: u.name ?? u.email, hint: u.email }))}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={deployGated}
              onChange={(e) => setDeployGated(e.target.checked)}
              className="h-4 w-4"
            />
            Deployment migration
            <span className="text-xs text-slate-500">— ships with a code deploy; only an admin or deployer can apply it.</span>
          </label>
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
          <Button variant="secondary" onClick={() => submit('draft')} loading={saving} disabled={locked}>
            {editMode ? 'Save changes' : 'Save as draft'}
          </Button>
          <Button onClick={() => submit('submit')} loading={saving} disabled={locked}>
            {editMode ? 'Save & submit' : 'Submit for approval'}
          </Button>
        </div>
      </div>
    </>
  )
}
