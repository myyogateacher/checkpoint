import { useEffect, useState } from 'react'
import { FaCheckDouble, FaLayerGroup, FaRocket, FaUserCheck, FaUserShield } from 'react-icons/fa'
import { api } from '../services/api'
import type { Environment, ManagedUser, ProjectSettings } from '../types'
import { useAuth } from '../context/AuthContext'
import { can } from '../lib/format'
import { notify } from '../lib/toast'
import { Button, Card, Field, Spinner } from '../components/ui'
import { Dropdown } from '../components/Dropdown'
import { ALL_USERS, UserMultiSelect } from '../components/UserMultiSelect'
import { useProject } from './ProjectLayout'

// Scope for the governance rules being viewed/edited: the project-wide defaults,
// or one environment's override of them.
const DEFAULT_SCOPE = ''

export function ProjectSettingsPage() {
  const project = useProject()
  const { user } = useAuth()
  const isAdmin = can(user?.role, 'manage_users')
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [scope, setScope] = useState<string>(DEFAULT_SCOPE) // '' = project defaults, else env id
  const [settings, setSettings] = useState<ProjectSettings | null>(null)
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void api.getEnvironments(project.id).then(setEnvironments)
    void api.getUsers().then(setUsers)
  }, [project.id])

  useEffect(() => {
    setSettings(null)
    void api.getProjectSettings(project.id, scope || undefined).then(setSettings)
  }, [project.id, scope])

  // An environment scope that inherits stays read-only until the admin explicitly
  // creates an override, so defaults aren't forked by accident.
  const inherited = Boolean(scope && settings?.inherited)
  const editable = isAdmin && !inherited

  async function save() {
    if (!settings) return
    setSaving(true)
    try {
      const saved = await api.saveProjectSettings(project.id, settings, scope || undefined)
      setSettings(saved)
      notify.success(scope ? `Settings saved for ${envName(scope)}` : 'Project settings saved')
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  async function resetOverride() {
    if (!scope) return
    setSaving(true)
    try {
      await api.resetProjectEnvSettings(project.id, scope)
      setSettings(await api.getProjectSettings(project.id, scope))
      notify.success(`${envName(scope)} now inherits the project defaults`)
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to reset override')
    } finally {
      setSaving(false)
    }
  }

  function envName(envId: string): string {
    return environments.find((e) => e.id === envId)?.name ?? 'environment'
  }

  const scopeOptions = [
    { value: DEFAULT_SCOPE, label: 'Project defaults' },
    ...environments.map((e) => ({ value: e.id, label: e.name })),
  ]

  if (!settings) {
    return (
      <Card className="p-6">
        <Spinner label="Loading settings…" />
      </Card>
    )
  }

  // Required approvals can't exceed the number of approvers; 0 means no approval
  // is required before release. With "All Users" the pool is every org member —
  // floored at the saved value so the current option still exists while the user
  // list is still loading (it arrives from a separate request than the settings).
  const allApprovers = settings.approvers.includes(ALL_USERS)
  const maxRequired = allApprovers
    ? Math.max(users.length, settings.required_approvals)
    : settings.approvers.length
  const approvalOptions = Array.from({ length: maxRequired + 1 }, (_, i) => ({
    value: String(i),
    label: String(i),
  }))

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <FaLayerGroup className="text-violet-500" />
          <h2 className="text-sm font-semibold text-slate-800">Rules scope</h2>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Field label="Environment" hint="Rules apply per environment. Environments without an override inherit the project defaults.">
            <Dropdown value={scope} options={scopeOptions} onChange={setScope} className="w-56" />
          </Field>
          {scope ? (
            inherited ? (
              <div className="flex items-center gap-3">
                <p className="text-xs text-slate-500">Inheriting project defaults.</p>
                {isAdmin ? (
                  <Button variant="secondary" onClick={() => setSettings((s) => (s ? { ...s, inherited: false } : s))}>
                    Override for {envName(scope)}
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <p className="text-xs text-slate-500">Overriding project defaults.</p>
                {isAdmin ? (
                  <Button variant="secondary" onClick={resetOverride} loading={saving}>
                    Reset to project defaults
                  </Button>
                ) : null}
              </div>
            )
          ) : null}
        </div>
      </Card>

      {editable ? (
        <div className="flex justify-end">
          <Button onClick={save} loading={saving}>
            {scope ? `Save for ${envName(scope)}` : 'Save changes'}
          </Button>
        </div>
      ) : !isAdmin ? (
        <p className="text-sm text-slate-500">You have read-only access to these settings.</p>
      ) : null}

      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <FaUserCheck className="text-emerald-500" />
          <h2 className="text-sm font-semibold text-slate-800">Approvers</h2>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Users who may approve migrations in {project.name}
          {scope ? ` / ${envName(scope)}` : ''}.
        </p>
        <UserMultiSelect
          users={users}
          selected={settings.approvers}
          editable={editable}
          placeholder="Add approver…"
          allLabel="All Users"
          onChange={(approvers) =>
            setSettings((s) => {
              if (!s) return s
              // "All Users" makes the pool everyone, so there is nothing to clamp to.
              if (approvers.includes(ALL_USERS)) return { ...s, approvers }
              return { ...s, approvers, required_approvals: Math.min(s.required_approvals, approvers.length) }
            })
          }
        />
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <FaRocket className="text-indigo-500" />
          <h2 className="text-sm font-semibold text-slate-800">Releasers</h2>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Users who may apply (release) an approved migration to the database.
        </p>
        <UserMultiSelect
          users={users}
          selected={settings.releasers}
          editable={editable}
          placeholder="Add releaser…"
          allLabel="All Users"
          onChange={(releasers) => setSettings((s) => (s ? { ...s, releasers } : s))}
        />
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <FaCheckDouble className="text-sky-500" />
          <h2 className="text-sm font-semibold text-slate-800">Approval policy</h2>
        </div>
        <Field
          label="Approvals required before release"
          hint={`Between 0 and ${maxRequired} (the number of ${allApprovers ? 'org members' : 'approvers'}). 0 means no approval is required before release.`}
        >
          {editable ? (
            <Dropdown
              value={String(settings.required_approvals)}
              options={approvalOptions}
              onChange={(v) => setSettings((s) => (s ? { ...s, required_approvals: Number(v) } : s))}
              className="w-40"
            />
          ) : (
            <p className="text-sm font-medium text-slate-800">{settings.required_approvals}</p>
          )}
        </Field>
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <FaUserShield className="text-amber-500" />
          <h2 className="text-sm font-semibold text-slate-800">Self-approval</h2>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Users who may approve their own migrations. Anyone not listed needs a migration of theirs approved by
          someone else. Pick “All Users” to allow it for everyone.
        </p>
        <UserMultiSelect
          users={users}
          selected={settings.self_approvers}
          editable={editable}
          placeholder="Grant self-approval…"
          allLabel="All Users"
          onChange={(self_approvers) => setSettings((s) => (s ? { ...s, self_approvers } : s))}
        />
      </Card>
    </div>
  )
}
