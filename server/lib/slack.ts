import { queryOne } from '../db/pool'
import { asJson } from './serialize'

// Slack notification settings, persisted per-org inside app_settings.slack
// (see server/modules/settings.ts). Mirrors the client's AppSettings['slack'].
interface SlackSettings {
  enabled: boolean
  notification_token: string
  channel_id: string
  notify_on_submit: boolean
  notify_on_approve: boolean
  notify_on_apply: boolean
}

const DEFAULTS: SlackSettings = {
  enabled: false,
  notification_token: '',
  channel_id: '',
  notify_on_submit: true,
  notify_on_approve: false,
  notify_on_apply: true,
}

type MigrationEvent = 'submit' | 'approve' | 'apply'

const TOGGLE: Record<MigrationEvent, keyof SlackSettings> = {
  submit: 'notify_on_submit',
  approve: 'notify_on_approve',
  apply: 'notify_on_apply',
}

async function loadSlack(orgId: string): Promise<SlackSettings | null> {
  const row = await queryOne<{ slack: unknown }>('SELECT slack FROM app_settings WHERE org_id = :org', { org: orgId })
  if (!row) return null
  return asJson<SlackSettings>(row.slack, DEFAULTS)
}

// Post a message to the org's configured Slack channel via chat.postMessage.
// Notifications are best-effort: any failure is logged and swallowed so it never
// breaks the migration request that triggered it.
async function postMessage(slack: SlackSettings, text: string): Promise<void> {
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${slack.notification_token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel: slack.channel_id, text }),
      signal: AbortSignal.timeout(8000),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!data.ok) {
      console.error(`[slack] chat.postMessage failed: ${data.error ?? `HTTP ${res.status}`}`)
    }
  } catch (err) {
    console.error(`[slack] notification failed: ${(err as Error).message}`)
  }
}

const LABEL: Record<MigrationEvent, string> = {
  submit: ':large_yellow_circle: *Migration submitted for approval*',
  approve: ':white_check_mark: *Migration approved*',
  apply: ':rocket: *Migration applied*',
}

// Notify the org's Slack channel about a migration lifecycle event, honoring the
// per-event toggle. No-op when Slack is disabled/unconfigured or the toggle is off.
export async function notifyMigration(
  orgId: string,
  event: MigrationEvent,
  info: { title: string; database: string; actor: string; url?: string },
): Promise<void> {
  const slack = await loadSlack(orgId)
  if (!slack || !slack.enabled || !slack.notification_token || !slack.channel_id) return
  if (!slack[TOGGLE[event]]) return
  const verb = event === 'submit' ? 'Submitted' : event === 'approve' ? 'Approved' : 'Applied'
  const link = info.url ? `\n<${info.url}|View migration>` : ''
  const text = `${LABEL[event]}\n*${info.title}* — ${info.database}\n${verb} by ${info.actor}${link}`
  await postMessage(slack, text)
}
