import { useEffect, useState } from 'react'
import { FaCheckDouble, FaRocket, FaUserCheck } from 'react-icons/fa'
import { api } from '../services/api'
import type { ManagedUser, ProjectSettings } from '../types'
import { useAuth } from '../context/AuthContext'
import { can } from '../lib/format'
import { notify } from '../lib/toast'
import { Button, Card, Field, Spinner } from '../components/ui'
import { Dropdown } from '../components/Dropdown'
import { UserMultiSelect } from '../components/UserMultiSelect'
import { useProject } from './ProjectLayout'

export function ProjectSettingsPage() {
  const project = useProject()
  const { user } = useAuth()
  const editable = can(user?.role, 'manage_users')
  const [settings, setSettings] = useState<ProjectSettings | null>(null)
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setSettings(null)
    void api.getProjectSettings(project.id).then(setSettings)
    void api.getUsers().then(setUsers)
  }, [project.id])

  async function save() {
    if (!settings) return
    setSaving(true)
    try {
      const saved = await api.saveProjectSettings(project.id, settings)
      setSettings(saved)
      notify.success('Project settings saved')
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (!settings) {
    return (
      <Card className="p-6">
        <Spinner label="Loading settings…" />
      </Card>
    )
  }

  // Required approvals can't exceed the number of approvers (min 1).
  const maxRequired = Math.max(1, settings.approvers.length)
  const approvalOptions = Array.from({ length: maxRequired }, (_, i) => ({
    value: String(i + 1),
    label: String(i + 1),
  }))

  return (
    <div className="space-y-4">
      {editable ? (
        <div className="flex justify-end">
          <Button onClick={save} loading={saving}>
            Save changes
          </Button>
        </div>
      ) : (
        <p className="text-sm text-slate-500">You have read-only access to these settings.</p>
      )}

      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <FaUserCheck className="text-emerald-500" />
          <h2 className="text-sm font-semibold text-slate-800">Approvers</h2>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Users who may approve migrations in {project.name}.
        </p>
        <UserMultiSelect
          users={users}
          selected={settings.approvers}
          editable={editable}
          placeholder="Add approver…"
          onChange={(approvers) =>
            setSettings((s) =>
              s ? { ...s, approvers, required_approvals: Math.min(s.required_approvals, Math.max(1, approvers.length)) } : s,
            )
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
          hint={`Between 1 and ${maxRequired} (the number of approvers).`}
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
    </div>
  )
}
