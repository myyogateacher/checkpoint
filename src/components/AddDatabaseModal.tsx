import { useMemo, useState } from 'react'
import { api } from '../services/api'
import type { ConnectionInput, Database, DatabaseEngine, Environment } from '../types'
import { notify } from '../lib/toast'
import { ENGINE_OPTIONS, engineDefaultPort, engineUsesSingleConnection } from '../lib/engines'
import { Button, ErrorBanner, Field, Modal, TextInput } from './ui'
import { Dropdown } from './Dropdown'
import { TestConnectionButton } from './TestConnectionButton'

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
  // The second arg carries a freshly-created environment so the page can show it
  // immediately (otherwise the new DB lands under an env with no card on screen).
  onCreated: (db: Database, newEnvironment?: Environment) => void
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

  const single = engineUsesSingleConnection(engine)

  // When the engine changes, refresh default ports if the user hasn't overridden
  // them, and swap in the defaults that suit single-connection stores (Redis: DB
  // index 0, no username, TLS off — most private-network Redis is plain TCP).
  function changeEngine(next: DatabaseEngine) {
    const wasSingle = engineUsesSingleConnection(engine)
    const toSingle = engineUsesSingleConnection(next)
    const adapt = (c: ConnectionInput, sqlUser: string): ConnectionInput => {
      const port = c.port === engineDefaultPort(engine) ? engineDefaultPort(next) : c.port
      if (toSingle && !wasSingle) return { ...c, port, username: c.username === sqlUser ? '' : c.username, database: '0', ssl: false }
      if (wasSingle && !toSingle) return { ...c, port, username: c.username || sqlUser, database: c.database === '0' ? '' : c.database, ssl: true }
      return { ...c, port }
    }
    setEngine(next)
    setRead((r) => adapt(r, 'readonly'))
    setWrite((w) => adapt(w, 'migrator'))
  }

  const canSubmit = useMemo(
    () =>
      name.trim() &&
      (showNewEnvInput ? newEnvName.trim() : environmentId) &&
      read.host.trim() &&
      read.database.trim() &&
      (single || (write.host.trim() && write.database.trim())),
    [name, environmentId, showNewEnvInput, newEnvName, read, write, single],
  )

  async function submit() {
    setError(null)
    if (!canSubmit) {
      return setError(
        single
          ? 'Name, environment, host and DB index are required.'
          : 'Name, environment, and both read & write connection host/database are required.',
      )
    }
    setSaving(true)
    try {
      let envId = environmentId
      let createdEnv: Environment | undefined
      if (showNewEnvInput) {
        createdEnv = await api.createEnvironment(projectId, { name: newEnvName.trim() })
        envId = createdEnv.id
      }
      const db = await api.createDatabase({
        project_id: projectId,
        environment_id: envId,
        name: name.trim(),
        engine,
        tags: tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
        read,
        // One read/write credential: store it as both connections.
        write: single ? read : write,
      })
      notify.success(`Database “${db.name}” added`)
      onCreated(db, createdEnv)
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

      {single ? (
        <SingleConnectionFields engine={engine} value={read} onChange={setRead} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <ConnectionFields legend="Read connection" engine={engine} value={read} onChange={setRead} />
          <ConnectionFields legend="Write connection" engine={engine} value={write} onChange={setWrite} />
        </div>
      )}

      <ErrorBanner message={error} />
    </Modal>
  )
}

function ConnectionFields({
  legend,
  engine,
  value,
  onChange,
}: {
  legend: string
  engine: DatabaseEngine
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
      <div className="mt-2 border-t border-slate-200/50 pt-2">
        <TestConnectionButton
          engine={engine}
          host={value.host}
          port={value.port}
          username={value.username}
          database={value.database}
          ssl={value.ssl}
          password={value.password}
        />
      </div>
    </fieldset>
  )
}

// Redis-style form: one connection used for both reads and writes, with the
// fields Redis actually has — a numeric DB index, optional ACL username, TLS.
function SingleConnectionFields({
  engine,
  value,
  onChange,
}: {
  engine: DatabaseEngine
  value: ConnectionInput
  onChange: (c: ConnectionInput) => void
}) {
  return (
    <fieldset className="rounded-xl border border-slate-200/60 bg-white/30 p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Connection</legend>
      <p className="mb-2 text-xs text-slate-500">
        Redis uses a single credential for reads and writes, so this connection is used for both.
      </p>
      <div className="grid grid-cols-2 gap-3 gap-y-2 md:grid-cols-4">
        <div className="col-span-2">
          <Field label="Host">
            <TextInput
              value={value.host}
              onChange={(e) => onChange({ ...value, host: e.target.value })}
              placeholder="redis.internal"
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
        <Field label="DB index" hint="0–15">
          <TextInput
            type="number"
            min={0}
            value={value.database}
            onChange={(e) => onChange({ ...value, database: e.target.value })}
            placeholder="0"
          />
        </Field>
        <div className="col-span-2">
          <Field label="Username" hint="Optional — only for Redis 6+ ACL users">
            <TextInput
              value={value.username}
              onChange={(e) => onChange({ ...value, username: e.target.value })}
              placeholder="default"
            />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Password" hint="Optional — leave blank if AUTH isn't enabled">
            <TextInput
              type="password"
              value={value.password}
              onChange={(e) => onChange({ ...value, password: e.target.value })}
              placeholder="••••••••"
            />
          </Field>
        </div>
        <label className="col-span-2 flex items-center gap-2 pb-1 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={value.ssl}
            onChange={(e) => onChange({ ...value, ssl: e.target.checked })}
            className="h-4 w-4"
          />
          Use TLS
        </label>
      </div>
      <div className="mt-2 border-t border-slate-200/50 pt-2">
        <TestConnectionButton
          engine={engine}
          host={value.host}
          port={value.port}
          username={value.username}
          database={value.database}
          ssl={value.ssl}
          password={value.password}
        />
      </div>
    </fieldset>
  )
}
