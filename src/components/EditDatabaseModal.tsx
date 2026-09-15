import { useState } from 'react'
import { api } from '../services/api'
import type { Database } from '../types'
import { notify } from '../lib/toast'
import { Button, ErrorBanner, Field, Modal, TextInput } from './ui'

// Rename a database and edit its tags. Engine, project, environment and the
// connections are deliberately not editable here — connections have their own
// tab, and the rest is fixed at creation.
export function EditDatabaseModal({
  database,
  onClose,
  onUpdated,
}: {
  database: Database
  onClose: () => void
  onUpdated: (db: Database) => void
}) {
  const [name, setName] = useState(database.name)
  const [tags, setTags] = useState(database.tags.join(', '))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const nextTags = Array.from(new Set(tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)))
  const dirty = name.trim() !== database.name || nextTags.join(',') !== database.tags.join(',')

  async function save() {
    setError(null)
    if (!name.trim()) return setError('A name is required.')
    setSaving(true)
    try {
      const updated = await api.updateDatabase(database.id, { name: name.trim(), tags: nextTags })
      notify.success(`Updated ${updated.name}`)
      onUpdated(updated)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update database'
      setError(msg)
      notify.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={`Edit ${database.name}`}
      onClose={onClose}
      maxWidthClass="max-w-md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={!dirty || !name.trim()}>
            Save changes
          </Button>
        </>
      }
    >
      <Field label="Name">
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="app_main"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && dirty && !saving) void save()
          }}
        />
      </Field>
      <Field label="Tags" hint="Comma-separated, optional">
        <TextInput value={tags} onChange={(e) => setTags(e.target.value)} placeholder="primary, pii" />
      </Field>
      <ErrorBanner message={error} />
    </Modal>
  )
}
