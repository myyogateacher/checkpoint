import { useState } from 'react'
import { FaCheck, FaCopy, FaLink } from 'react-icons/fa'
import { api } from '../services/api'
import type { Database, SavedQuery } from '../types'
import { notify } from '../lib/toast'
import { Button, ErrorBanner, Field, Modal, TextArea, TextInput } from './ui'

// Used by the read panel's Save / Share actions. In "share" mode, after saving
// it reveals a shareable URL that opens Query Studio with this query loaded.
export function SaveQueryModal({
  mode,
  database,
  sql,
  onClose,
  onSaved,
}: {
  mode: 'save' | 'share'
  database: Database
  sql: string
  onClose: () => void
  onSaved?: (q: SavedQuery) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function submit() {
    if (!name.trim()) return setError('A name is required.')
    setBusy(true)
    setError(null)
    try {
      const saved = await api.createSavedQuery({
        database_id: database.id,
        name: name.trim(),
        description: description.trim() || null,
        tags: tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
        sql,
        shared: mode === 'share',
      })
      onSaved?.(saved)
      if (mode === 'share') {
        setShareUrl(`${window.location.origin}/query?saved=${saved.id}`)
        notify.success('Shareable query link created')
      } else {
        notify.success(`Saved “${saved.name}”`)
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save query')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard may be unavailable */
    }
  }

  const title = mode === 'share' ? 'Share query' : 'Save query'

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        shareUrl ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} loading={busy} disabled={!name.trim()}>
              {mode === 'share' ? 'Share' : 'Save'}
            </Button>
          </>
        )
      }
    >
      {shareUrl ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Anyone with access can open this query in Query Studio:
          </p>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200/60 bg-white/40 px-3 py-2">
            <FaLink className="shrink-0 text-slate-400" size={12} />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700 dark:text-slate-200">
              {shareUrl}
            </span>
            <button
              onClick={copy}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-white/60 bg-white/60 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-white/80"
            >
              {copied ? <FaCheck size={10} className="text-emerald-500" /> : <FaCopy size={10} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <Field label="Name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Active users (30d)" />
          </Field>
          <Field label="Description" hint="Optional">
            <TextArea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this query answer?"
            />
          </Field>
          <Field label="Tags" hint="Comma-separated, optional">
            <TextInput value={tags} onChange={(e) => setTags(e.target.value)} placeholder="users, analytics" />
          </Field>
          <p className="text-xs text-slate-500">
            Target: <span className="font-mono">{database.name}</span>
          </p>
          <ErrorBanner message={error} />
        </>
      )}
    </Modal>
  )
}
