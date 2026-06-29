import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FaBuilding } from 'react-icons/fa'
import { api } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useOrg } from '../context/OrgContext'
import { notify } from '../lib/toast'
import { AuthShell, authInputClass, primaryBtnClass } from '../components/AuthShell'

// Shown after sign-in when the user belongs to no organization.
export function CreateOrgPage() {
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const { refresh, setCurrentOrg, orgs } = useOrg()
  const hasOrgs = orgs.length > 0
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      const org = await api.createOrganization(name.trim())
      await refresh()
      setCurrentOrg(org.id)
      notify.success(`Organization “${org.name}” created`)
      navigate('/')
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to create organization')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      eyebrow="One last step"
      title="Create your organization"
      subtitle="Organizations hold your projects, databases, and team. You can invite others once it's set up."
    >
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Organization name</span>
          <div className="relative">
            <FaBuilding className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={12} />
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Inc"
              className={`${authInputClass} pl-9`}
            />
          </div>
        </label>
        <button type="submit" disabled={busy || !name.trim()} className={primaryBtnClass}>
          {busy ? 'Creating…' : 'Create organization'}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-slate-500">
        {hasOrgs ? (
          <button onClick={() => navigate('/')} className="cursor-pointer font-medium text-indigo-600 hover:underline">
            Cancel
          </button>
        ) : (
          <button onClick={() => void signOut()} className="cursor-pointer font-medium text-indigo-600 hover:underline">
            Sign out
          </button>
        )}
      </p>
    </AuthShell>
  )
}
