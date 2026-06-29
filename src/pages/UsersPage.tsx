import { useEffect, useState } from 'react'
import { FaTrash, FaUserPlus } from 'react-icons/fa'
import { api } from '../services/api'
import type { ManagedUser, UserRole } from '../types'
import { formatDate } from '../lib/format'
import { notify } from '../lib/toast'
import { PageHeader } from '../components/PageHeader'
import { RoleBadge } from '../components/badges'
import { Dropdown } from '../components/Dropdown'
import { Button, Card, ErrorBanner, Field, Modal, Spinner, TextInput } from '../components/ui'

const ROLES: UserRole[] = ['admin', 'editor', 'viewer']

const ROLE_HINTS: Record<UserRole, string> = {
  admin: 'Full access — approve & apply migrations, manage users, connections & settings.',
  editor: 'Create & submit migrations, add reviewers, comment, run read queries, pull schema.',
  viewer: 'Read-only — browse schema and run read queries.',
}

const ROLE_OPTIONS = ROLES.map((r) => ({
  value: r,
  label: r.charAt(0).toUpperCase() + r.slice(1),
  hint: ROLE_HINTS[r],
}))

export function UsersPage() {
  const [users, setUsers] = useState<ManagedUser[] | null>(null)
  const [showInvite, setShowInvite] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('viewer')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.getUsers().then(setUsers)
  }, [])

  async function invite() {
    if (!email.includes('@')) return setError('Enter a valid email.')
    setBusy(true)
    setError(null)
    try {
      const user = await api.inviteUser(email.trim(), role)
      setUsers((prev) => [...(prev ?? []), user])
      setShowInvite(false)
      setEmail('')
      setRole('viewer')
      notify.success(`Invited ${user.email} as ${user.role}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to invite'
      setError(msg)
      notify.error(msg)
    } finally {
      setBusy(false)
    }
  }

  async function changeRole(id: string, nextRole: UserRole) {
    try {
      const updated = await api.setUserRole(id, nextRole)
      setUsers((prev) => prev?.map((u) => (u.id === id ? updated : u)) ?? null)
      notify.success(`Role updated to ${nextRole}`)
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to update role')
    }
  }

  async function remove(id: string) {
    const removed = users?.find((u) => u.id === id)
    try {
      await api.removeUser(id)
      setUsers((prev) => prev?.filter((u) => u.id !== id) ?? null)
      notify.success(`Removed ${removed?.email ?? 'user'}`)
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to remove user')
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Access"
        title="Team"
        description="Roles control who can create, approve, and apply migrations."
        actions={
          <Button onClick={() => setShowInvite(true)}>
            <FaUserPlus size={12} /> Invite user
          </Button>
        }
      />

      <Card className="p-5">
        {users === null ? (
          <Spinner />
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200/60">
            <table className="w-full text-sm">
              <thead className="bg-white/50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Last login</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/50">
                {users.map((u) => (
                  <tr key={u.id} className="bg-white/30 hover:bg-white/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-semibold text-white">
                          {(u.name ?? u.email).charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-slate-800">
                            {u.name ?? u.email}
                            {u.is_self ? <span className="ml-2 text-xs text-slate-400">(you)</span> : null}
                          </p>
                          <p className="text-xs text-slate-500">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {u.is_self ? (
                        <RoleBadge role={u.role} />
                      ) : (
                        <Dropdown
                          value={u.role}
                          options={ROLE_OPTIONS}
                          onChange={(v) => changeRole(u.id, v as UserRole)}
                          className="w-36"
                          menuMinWidth={300}
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(u.last_login_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {!u.is_self ? (
                        <button
                          onClick={() => remove(u.id)}
                          className="cursor-pointer rounded p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                          title="Remove user"
                        >
                          <FaTrash size={12} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showInvite}
        title="Invite user"
        onClose={() => setShowInvite(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowInvite(false)}>
              Cancel
            </Button>
            <Button onClick={invite} loading={busy}>
              Send invite
            </Button>
          </>
        }
      >
        <Field label="Email">
          <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" />
        </Field>
        <Field label="Role">
          <Dropdown value={role} options={ROLE_OPTIONS} onChange={(v) => setRole(v as UserRole)} menuMinWidth={300} />
        </Field>
        <ErrorBanner message={error} />
      </Modal>
    </>
  )
}
