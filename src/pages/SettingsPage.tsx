import { useEffect, useState } from 'react'
import { FaEnvelope, FaPlay, FaSlack } from 'react-icons/fa'
import { api } from '../services/api'
import type { AppSettings } from '../types'
import { notify } from '../lib/toast'
import { PageHeader } from '../components/PageHeader'
import { Button, Card, Field, Spinner, TextInput } from '../components/ui'

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-slate-700 dark:text-slate-200">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition ${
          checked ? 'bg-gradient-to-r from-blue-600 to-indigo-600' : 'bg-slate-300 dark:bg-slate-600'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-4' : 'left-0.5'}`}
        />
      </button>
    </label>
  )
}

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [emailPassword, setEmailPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'email' | 'slack' | 'query'>('email')

  useEffect(() => {
    void api.getSettings().then(setSettings)
  }, [])

  async function save() {
    if (!settings) return
    setSaving(true)
    try {
      const next: AppSettings = {
        ...settings,
        email: { ...settings.email, has_password: settings.email.has_password || emailPassword.length > 0 },
      }
      const saved = await api.saveSettings(next)
      setSettings(saved)
      setEmailPassword('')
      notify.success('Settings saved')
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

  const { email, slack } = settings

  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Configure how Checkpoint sends notifications for migration activity."
        actions={
          <Button onClick={save} loading={saving}>
            Save changes
          </Button>
        }
      />

      <div className="mb-6 flex flex-wrap gap-1 rounded-full border border-white/60 bg-white/55 p-1 backdrop-blur md:max-w-fit">
        {([
          { key: 'email', label: 'Email', icon: <FaEnvelope size={12} /> },
          { key: 'slack', label: 'Slack', icon: <FaSlack size={12} /> },
          { key: 'query', label: 'Query', icon: <FaPlay size={12} /> },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
              tab === t.key
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow'
                : 'text-slate-600 hover:bg-white/75'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'email' ? (
        <Card className="max-w-2xl p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FaEnvelope className="text-sky-500" />
              <h2 className="text-sm font-semibold text-slate-800">Email (SMTP)</h2>
            </div>
            <Toggle
              checked={email.enabled}
              onChange={(v) => setSettings({ ...settings, email: { ...email, enabled: v } })}
              label=""
            />
          </div>

          <div className={`space-y-3 ${email.enabled ? '' : 'pointer-events-none opacity-50'}`}>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Field label="SMTP host">
                  <TextInput
                    value={email.smtp_host}
                    onChange={(e) => setSettings({ ...settings, email: { ...email, smtp_host: e.target.value } })}
                    placeholder="smtp.example.com"
                  />
                </Field>
              </div>
              <Field label="Port">
                <TextInput
                  type="number"
                  value={email.smtp_port}
                  onChange={(e) => setSettings({ ...settings, email: { ...email, smtp_port: Number(e.target.value) } })}
                />
              </Field>
            </div>
            <Field label="From address">
              <TextInput
                value={email.from_address}
                onChange={(e) => setSettings({ ...settings, email: { ...email, from_address: e.target.value } })}
                placeholder="checkpoint@company.com"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Username">
                <TextInput
                  value={email.username}
                  onChange={(e) => setSettings({ ...settings, email: { ...email, username: e.target.value } })}
                />
              </Field>
              <Field label="Password" hint={email.has_password ? 'Leave blank to keep current' : undefined}>
                <TextInput
                  type="password"
                  value={emailPassword}
                  onChange={(e) => setEmailPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </Field>
            </div>
          </div>
        </Card>
      ) : tab === 'slack' ? (
        <Card className="max-w-2xl p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FaSlack className="text-[#4A154B] dark:text-violet-400" />
              <h2 className="text-sm font-semibold text-slate-800">Slack notifications</h2>
            </div>
            <Toggle
              checked={slack.enabled}
              onChange={(v) => setSettings({ ...settings, slack: { ...slack, enabled: v } })}
              label=""
            />
          </div>

          <div className={`space-y-3 ${slack.enabled ? '' : 'pointer-events-none opacity-50'}`}>
            <Field label="Notification token" hint="Bot token (xoxb-…) used to post rich messages via the Slack API.">
              <TextInput
                type="password"
                value={slack.notification_token}
                onChange={(e) => setSettings({ ...settings, slack: { ...slack, notification_token: e.target.value } })}
                placeholder="xoxb-…"
              />
            </Field>
            <Field label="Channel ID" hint="e.g. C012AB3CD — the target channel's ID, not its name.">
              <TextInput
                value={slack.channel_id}
                onChange={(e) => setSettings({ ...settings, slack: { ...slack, channel_id: e.target.value } })}
                placeholder="C012AB3CD"
              />
            </Field>
            <div className="border-t border-slate-200/60 pt-2">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Notify on</p>
              <Toggle
                checked={slack.notify_on_submit}
                onChange={(v) => setSettings({ ...settings, slack: { ...slack, notify_on_submit: v } })}
                label="Migration submitted for approval"
              />
              <Toggle
                checked={slack.notify_on_approve}
                onChange={(v) => setSettings({ ...settings, slack: { ...slack, notify_on_approve: v } })}
                label="Migration approved"
              />
              <Toggle
                checked={slack.notify_on_apply}
                onChange={(v) => setSettings({ ...settings, slack: { ...slack, notify_on_apply: v } })}
                label="Migration applied"
              />
            </div>
          </div>
        </Card>
      ) : (
        <Card className="max-w-2xl p-5">
          <div className="mb-4 flex items-center gap-2">
            <FaPlay className="text-indigo-500" />
            <h2 className="text-sm font-semibold text-slate-800">Read queries</h2>
          </div>
          <div className="space-y-4">
            <Field
              label="Default query timeout (seconds)"
              hint="Applied as a statement timeout to every query run from the read panel."
            >
              <TextInput
                type="number"
                min={1}
                value={settings.query.default_timeout_seconds}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    query: { ...settings.query, default_timeout_seconds: Number(e.target.value) },
                  })
                }
                className="max-w-40"
              />
            </Field>
            <Toggle
              checked={settings.query.format_on_run}
              onChange={(v) => setSettings({ ...settings, query: { ...settings.query, format_on_run: v } })}
              label="Auto-format SQL when a query is run"
            />
          </div>
        </Card>
      )}
    </>
  )
}
