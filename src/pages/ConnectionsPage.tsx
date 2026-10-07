import { useState } from 'react'
import { FaCheckCircle, FaLock, FaPlug } from 'react-icons/fa'
import { api } from '../services/api'
import type { Connection } from '../types'
import { useAuth } from '../context/AuthContext'
import { can } from '../lib/format'
import { engineUsesSingleConnection } from '../lib/engines'
import { notify } from '../lib/toast'
import { ConnectionBadge } from '../components/badges'
import { Button, Card, Field, Modal, TextInput } from '../components/ui'
import { TestConnectionButton } from '../components/TestConnectionButton'
import { useDatabase } from './DatabaseLayout'

export function ConnectionsPage() {
  const database = useDatabase()
  const { user } = useAuth()
  const [read, setRead] = useState(database.read_connection)
  const [write, setWrite] = useState(database.write_connection)
  const [editing, setEditing] = useState<Connection | null>(null)
  const single = engineUsesSingleConnection(database.engine)

  function onSaved(conn: Connection) {
    if (conn.mode === 'read') setRead(conn)
    else setWrite(conn)
    setEditing(null)
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {single ? (
        <ConnectionCard
          connection={write}
          single
          editable={can(user?.role, 'manage_users')}
          onEdit={() => setEditing(write)}
          note="One credential for reads and writes — used by the query panel. Admin-only to edit."
        />
      ) : (
        <>
          <ConnectionCard
            connection={read}
            editable={can(user?.role, 'manage_users')}
            onEdit={() => setEditing(read)}
            note="Used for the read panel and schema pulls. Admin-only to edit."
          />
          <ConnectionCard
            connection={write}
            editable={can(user?.role, 'manage_users')}
            onEdit={() => setEditing(write)}
            note="Used to apply approved migrations. Admin-only to edit."
          />
        </>
      )}

      {editing ? (
        <ConnectionEditor
          databaseId={database.id}
          engine={database.engine}
          connection={editing}
          single={single}
          onClose={() => setEditing(null)}
          onSaved={(conn) => {
            if (single) setRead({ ...conn, mode: 'read' })
            onSaved(conn)
          }}
        />
      ) : null}
    </div>
  )
}

function ConnectionCard({
  connection,
  single = false,
  editable,
  onEdit,
  note,
}: {
  connection: Connection
  single?: boolean
  editable: boolean
  onEdit: () => void
  note: string
}) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FaPlug className="text-slate-400" />
          {single ? (
            <>
              <h2 className="text-sm font-semibold text-slate-800">Connection</h2>
              <ConnectionBadge mode="read_write" />
            </>
          ) : (
            <>
              <h2 className="text-sm font-semibold capitalize text-slate-800">{connection.mode} connection</h2>
              <ConnectionBadge mode={connection.mode} />
            </>
          )}
        </div>
        {editable ? (
          <Button variant="secondary" onClick={onEdit}>
            Edit
          </Button>
        ) : null}
      </div>

      <dl className="space-y-2 text-sm">
        <Row label="Host" value={connection.host} mono />
        <Row label="Port" value={String(connection.port)} mono />
        <Row label={single ? 'DB index' : 'Database'} value={connection.database} mono />
        <Row label="Username" value={connection.username || '—'} mono />
        <Row label={single ? 'TLS' : 'SSL'} value={connection.ssl ? 'Required' : 'Disabled'} />
        <div className="flex items-center justify-between border-t border-slate-200/50 pt-2">
          <dt className="text-slate-500">Password</dt>
          <dd className="flex items-center gap-1.5 text-xs text-slate-500">
            <FaLock size={10} />
            {connection.has_password ? 'Stored securely' : 'Not set'}
          </dd>
        </div>
      </dl>

      <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500">
        <FaCheckCircle className="text-emerald-500" size={11} /> {note}
      </p>
    </Card>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`text-slate-800 ${mono ? 'font-mono text-[13px]' : ''}`}>{value}</dd>
    </div>
  )
}

function ConnectionEditor({
  databaseId,
  engine,
  connection,
  single,
  onClose,
  onSaved,
}: {
  databaseId: string
  engine: string
  connection: Connection
  single: boolean
  onClose: () => void
  onSaved: (c: Connection) => void
}) {
  const [form, setForm] = useState(connection)
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const next = { ...form, has_password: form.has_password || password.length > 0 }
      // A single read/write credential is stored as both connections; keep them in step.
      if (single) await api.updateConnection(databaseId, { ...next, mode: 'read' }, password || undefined)
      const saved = await api.updateConnection(databaseId, next, password || undefined)
      notify.success(single ? 'Connection updated' : `${saved.mode === 'read' ? 'Read' : 'Write'} connection updated`)
      onSaved(saved)
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to update connection')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={single ? 'Edit connection' : `Edit ${connection.mode} connection`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Save connection
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Host">
          <TextInput value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
        </Field>
        <Field label="Port">
          <TextInput
            type="number"
            value={form.port}
            onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
          />
        </Field>
        <Field label={single ? 'DB index' : 'Database'}>
          <TextInput value={form.database} onChange={(e) => setForm({ ...form, database: e.target.value })} />
        </Field>
        <Field label={single ? 'Username (optional)' : 'Username'}>
          <TextInput value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </Field>
      </div>
      <Field label="Password" hint={connection.has_password ? 'Leave blank to keep the current password.' : undefined}>
        <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={form.ssl}
          onChange={(e) => setForm({ ...form, ssl: e.target.checked })}
          className="h-4 w-4"
        />
        {single ? 'Use TLS' : 'Require SSL'}
      </label>
      <div className="mt-3 border-t border-slate-200/50 pt-3">
        <TestConnectionButton
          engine={engine}
          host={form.host}
          port={form.port}
          username={form.username}
          database={form.database}
          ssl={form.ssl}
          password={password}
          databaseId={databaseId}
          mode={form.mode}
        />
      </div>
    </Modal>
  )
}
