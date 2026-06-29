import { useMemo, useState } from 'react'
import { api } from '../services/api'
import type { ConnectionInput, Database, DatabaseEngine, Environment } from '../types'
import { notify } from '../lib/toast'
import { ENGINE_OPTIONS, engineDefaultPort } from '../lib/engines'
import { Button, ErrorBanner, Field, Modal, TextInput } from './ui'
import { Dropdown } from './Dropdown'

// Sentinel dropdown value that switches the Environment field into "create new" mode.
const NEW_ENV = '__new_env__'

function emptyConn(port: number, username: string): ConnectionInput {
  return { host: '', port, username, database: '', ssl: true, password: '' }
}

export function AddDatabaseModal({
  projectId,
  environments,
  defaultEnvironmentId,
  onClose,
  onCreated,
}: {
  projectId: string
  environments: Environment[]
  defaultEnvironmentId?: string
  onClose: () => void
  onCreated: (db: Database) => void
}) {
  const [environmentId, setEnvironmentId] = useState(defaultEnvironmentId ?? environments[0]?.id ?? '')
  const [newEnvName, setNewEnvName] = useState('')
  // When there are no environments we always show the create input; otherwise the
  // user can opt into creating a new one via the dropdown's "+ Create new" option.
  const [creatingEnv, setCreatingEnv] = useState(environments.length === 0)
  const showNewEnvInput = creatingEnv
  const [name, setName] = useState('')
  const [engine, setEngine] = useState<DatabaseEngine>('postgres')
  const [tags, setTags] = useState('')
  const [read, setRead] = useState<ConnectionInput>(emptyConn(engineDefaultPort('postgres'), 'readonly'))
  const [write, setWrite] = useState<ConnectionInput>(emptyConn(engineDefaultPort('postgres'), 'migrator'))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // When the engine changes, refresh default ports if the user hasn't overridden them.
  function changeEngine(next: DatabaseEngine) {
    setEngine(next)
    setRead((r) => ({ ...r, port: r.port === engineDefaultPort(engine) ? engineDefaultPort(next) : r.port }))
    setWrite((w) => ({ ...w, port: w.port === engineDefaultPort(engine) ? engineDefaultPort(next) : w.port }))
  }

  const canSubmit = useMemo(
    () =>
      name.trim() &&
      (showNewEnvInput ? newEnvName.trim() : environmentId) &&
      read.host.trim() &&
      read.database.trim() &&
      write.host.trim() &&
      write.database.trim(),
    [name, environmentId, showNewEnvInput, newEnvName, read, write],
  )

  async function submit() {
    setError(null)
    if (!canSubmit) return setError('Name, environment, and both read & write connection host/database are required.')
    setSaving(true)
    try {
      let envId = environmentId
      if (showNewEnvInput) {
        const env = await api.createEnvironment(projectId, { name: newEnvName.trim() })
        envId = env.id
      }
      const db = await api.createDatabase({
        project_id: projectId,
        environment_id: envId,
        name: name.trim(),
        engine,
        tags: tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
        read,
        write,
      })
      notify.success(`Database “${db.name}” added`)
      onCreated(db)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add database'
      setError(msg)
      notify.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title="Add database"
      maxWidthClass="max-w-5xl"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={!canSubmit}>
            Add database
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Environment" hint={showNewEnvInput ? 'A new environment will be created' : undefined}>
          {showNewEnvInput ? (
            <div className="flex items-center gap-2">
              <TextInput
                value={newEnvName}
                onChange={(e) => setNewEnvName(e.target.value)}
                placeholder="production"
              />
              {environments.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setCreatingEnv(false)
                    setNewEnvName('')
                  }}
                  className="shrink-0 text-xs font-medium text-slate-500 hover:text-slate-700"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          ) : (
            <Dropdown
              value={environmentId}
              options={[
                ...environments.map((env) => ({ value: env.id, label: env.name })),
                { value: NEW_ENV, label: '+ Create new environment' },
              ]}
              onChange={(v) => (v === NEW_ENV ? setCreatingEnv(true) : setEnvironmentId(v))}
            />
          )}
        </Field>
        <Field label="Engine">
          <Dropdown
            value={engine}
            options={ENGINE_OPTIONS}
            onChange={(v) => changeEngine(v as DatabaseEngine)}
            searchable
            searchPlaceholder="Search database type…"
            menuMinWidth={260}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="app_main" />
        </Field>
        <Field label="Tags" hint="Comma-separated, optional">
          <TextInput value={tags} onChange={(e) => setTags(e.target.value)} placeholder="primary, pii" />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ConnectionFields legend="Read connection" value={read} onChange={setRead} />
        <ConnectionFields legend="Write connection" value={write} onChange={setWrite} />
      </div>

      <ErrorBanner message={error} />
    </Modal>
  )
}

function ConnectionFields({
  legend,
  value,
  onChange,
}: {
  legend: string
  value: ConnectionInput
  onChange: (c: ConnectionInput) => void
}) {
  return (
    <fieldset className="h-full rounded-xl border border-slate-200/60 bg-white/30 p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{legend}</legend>
      <div className="grid grid-cols-2 gap-3 gap-y-2">
        <div className="col-span-2">
          <Field label="Host">
            <TextInput
              value={value.host}
              onChange={(e) => onChange({ ...value, host: e.target.value })}
              placeholder="db.internal"
            />
          </Field>
        </div>
        <Field label="Port">
          <TextInput
            type="number"
            value={value.port}
            onChange={(e) => onChange({ ...value, port: Number(e.target.value) })}
          />
        </Field>
        <Field label="Database">
          <TextInput value={value.database} onChange={(e) => onChange({ ...value, database: e.target.value })} placeholder="app_main" />
        </Field>
        <Field label="Username">
          <TextInput value={value.username} onChange={(e) => onChange({ ...value, username: e.target.value })} />
        </Field>
        <Field label="Password">
          <TextInput
            type="password"
            value={value.password}
            onChange={(e) => onChange({ ...value, password: e.target.value })}
            placeholder="••••••••"
          />
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={value.ssl}
            onChange={(e) => onChange({ ...value, ssl: e.target.checked })}
            className="h-4 w-4"
          />
          Require SSL
        </label>
      </div>
    </fieldset>
  )
}
