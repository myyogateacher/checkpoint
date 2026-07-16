import { useEffect, useState } from 'react'
import { FaCopy, FaKey } from 'react-icons/fa'
import { api } from '../services/api'
import type { ApiToken, ApiTokenCreated, ApiTokenScope } from '../types'
import { formatDate, relativeTime } from '../lib/format'
import { notify } from '../lib/toast'
import { PageHeader } from '../components/PageHeader'
import { Badge, Button, Card, EmptyState, Field, Modal, Spinner, TextInput } from '../components/ui'
import { Dropdown } from '../components/Dropdown'

const SCOPE_OPTIONS: Array<{ value: ApiTokenScope; label: string; hint: string }> = [
  { value: 'migrations:read', label: 'Read migrations', hint: 'List migrations and fetch their details' },
  { value: 'migrations:write', label: 'Create migrations', hint: 'Open (and optionally submit) migrations for review' },
]

const EXPIRY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
  { value: '', label: 'No expiry' },
]

function scopeLabel(scope: ApiTokenScope): string {
  return SCOPE_OPTIONS.find((s) => s.value === scope)?.label ?? scope
}

// A token is unusable when revoked or past its expiry; rows render muted.
function isInactive(t: ApiToken): boolean {
  return !!t.revoked_at || (!!t.expires_at && new Date(t.expires_at).getTime() <= Date.now())
}

function TokenRow({ token, onRevoke }: { token: ApiToken; onRevoke: (t: ApiToken) => void }) {
  const inactive = isInactive(token)
  return (
    <li className={`flex flex-wrap items-center gap-3 py-3 ${inactive ? 'opacity-60' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-slate-800">{token.name}</p>
          <code className="rounded bg-white/60 px-1.5 py-0.5 text-xs text-slate-500">{token.token_prefix}…</code>
          {token.scopes.map((s) => (
            <Badge key={s} className="border-indigo-200/70 bg-indigo-50/80 text-indigo-700 dark:border-indigo-400/40 dark:bg-indigo-500/20 dark:text-indigo-300">
              {scopeLabel(s)}
            </Badge>
          ))}
          {token.revoked_at ? (
            <Badge className="border-rose-200/70 bg-rose-50/80 text-rose-700 dark:border-rose-400/40 dark:bg-rose-500/25 dark:text-rose-200">Revoked</Badge>
          ) : inactive ? (
            <Badge className="border-amber-200/70 bg-amber-50/80 text-amber-700 dark:border-amber-400/40 dark:bg-amber-500/25 dark:text-amber-200">Expired</Badge>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Created {formatDate(token.created_at)} · {token.expires_at ? `Expires ${formatDate(token.expires_at)}` : 'No expiry'} · Last used{' '}
          {relativeTime(token.last_used_at)}
        </p>
      </div>
      {token.revoked_at ? null : (
        <Button variant="danger" onClick={() => onRevoke(token)}>
          Revoke
        </Button>
      )}
    </li>
  )
}

export function ApiTokensPage() {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<ApiTokenScope[]>(['migrations:read'])
  const [expiry, setExpiry] = useState('90')
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState<ApiTokenCreated | null>(null)
  const [revoking, setRevoking] = useState<ApiToken | null>(null)

  useEffect(() => {
    void api
      .getApiTokens()
      .then(setTokens)
      .catch((err: Error) => {
        notify.error(err.message)
        // Fall back to the empty state rather than an eternal spinner.
        setTokens([])
      })
  }, [])

  function toggleScope(scope: ApiTokenScope) {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]))
  }

  async function create() {
    if (!name.trim()) {
      notify.error('Give the token a name.')
      return
    }
    if (scopes.length === 0) {
      notify.error('Pick at least one scope.')
      return
    }
    setSaving(true)
    try {
      const token = await api.createApiToken({ name: name.trim(), scopes, expires_in_days: expiry ? Number(expiry) : null })
      setTokens((prev) => [token, ...(prev ?? [])])
      setCreateOpen(false)
      setCreated(token)
      setName('')
      setScopes(['migrations:read'])
      setExpiry('90')
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to create token')
    } finally {
      setSaving(false)
    }
  }

  async function copyToken() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.token)
      notify.success('Token copied to clipboard')
    } catch {
      // Clipboard may be unavailable (non-secure origin); the token stays selectable.
      notify.error('Copy failed — select the token text and copy it manually.')
    }
  }

  async function revoke() {
    if (!revoking) return
    try {
      await api.revokeApiToken(revoking.id)
      setTokens((prev) => (prev ?? []).map((t) => (t.id === revoking.id ? { ...t, revoked_at: new Date().toISOString() } : t)))
      notify.success(`Revoked "${revoking.name}"`)
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to revoke token')
    } finally {
      setRevoking(null)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="API Tokens"
        description="Personal access tokens for programmatic access — create migrations from CI or tools. Tokens act as you and can never do more than your role allows."
        actions={<Button onClick={() => setCreateOpen(true)}>New token</Button>}
      />

      <Card className="p-6">
        {tokens === null ? (
          <Spinner label="Loading tokens…" />
        ) : tokens.length === 0 ? (
          <EmptyState
            icon={<FaKey />}
            title="No API tokens yet"
            hint='Create a token to call the Checkpoint API — e.g. open migrations from a CI pipeline. See "API access" in the docs.'
          />
        ) : (
          <ul className="divide-y divide-slate-200/50">
            {tokens.map((t) => (
              <TokenRow key={t.id} token={t} onRevoke={setRevoking} />
            ))}
          </ul>
        )}
      </Card>

      {/* Create */}
      <Modal
        open={createOpen}
        title="New API token"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} loading={saving}>
              Create token
            </Button>
          </>
        }
      >
        <Field label="Name" hint="What will use this token — e.g. “GitHub Actions deploy”.">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="CI pipeline" maxLength={100} />
        </Field>
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">Scopes</span>
          <div className="space-y-2">
            {SCOPE_OPTIONS.map((s) => (
              <label key={s.value} className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={scopes.includes(s.value)}
                  onChange={() => toggleScope(s.value)}
                  className="mt-0.5 h-4 w-4 accent-indigo-600"
                />
                <span>
                  <span className="block text-sm text-slate-700">{s.label}</span>
                  <span className="block text-xs text-slate-500">{s.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">Approving and applying migrations is never available via token.</p>
        </div>
        <Field label="Expires">
          <Dropdown value={expiry} options={EXPIRY_OPTIONS} onChange={setExpiry} />
        </Field>
      </Modal>

      {/* One-time reveal */}
      <Modal
        open={created !== null}
        title="Token created"
        onClose={() => setCreated(null)}
        footer={<Button onClick={() => setCreated(null)}>Done</Button>}
      >
        <p className="text-sm text-slate-600">
          Copy your token now — <span className="font-medium text-slate-800">it will not be shown again</span>.
        </p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-lg border border-slate-200/70 bg-white/60 px-3 py-2 font-mono text-xs text-slate-800">
            {created?.token}
          </code>
          <Button variant="secondary" onClick={copyToken} title="Copy to clipboard">
            <FaCopy />
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          Send it as <code>Authorization: Bearer …</code>. Treat it like a password; revoke it here if it leaks.
        </p>
      </Modal>

      {/* Revoke confirm */}
      <Modal
        open={revoking !== null}
        title="Revoke token?"
        onClose={() => setRevoking(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevoking(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={revoke}>
              Revoke token
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          “{revoking?.name}” ({revoking?.token_prefix}…) will stop working immediately. Anything still using it will get
          authentication errors. This cannot be undone.
        </p>
      </Modal>
    </>
  )
}
