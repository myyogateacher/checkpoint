import { query, queryOne } from '../db/pool'
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
  notify_on_reviewer: boolean
}

const DEFAULTS: SlackSettings = {
  enabled: false,
  notification_token: '',
  channel_id: '',
  notify_on_submit: true,
  notify_on_approve: false,
  notify_on_apply: true,
  notify_on_reviewer: false,
}

type MigrationEvent = 'submit' | 'approve' | 'apply' | 'reviewer'

const TOGGLE: Record<MigrationEvent, keyof SlackSettings> = {
  submit: 'notify_on_submit',
  approve: 'notify_on_approve',
  apply: 'notify_on_apply',
  reviewer: 'notify_on_reviewer',
}

async function loadSlack(orgId: string): Promise<SlackSettings | null> {
  const row = await queryOne<{ slack: unknown }>('SELECT slack FROM app_settings WHERE org_id = :org', { org: orgId })
  if (!row) return null
  return asJson<SlackSettings>(row.slack, DEFAULTS)
}

// Cache email → Slack mention resolutions so we don't hit users.lookupByEmail on
// every notification. Keyed by token so separate workspaces never collide.
// `null` = looked up but no matching Slack user (so we fall back to plain email).
const mentionCache = new Map<string, string | null>()

// Resolve an email to a Slack mention token (`<@U…>`). Returns null when the email
// has no Slack account or the lookup fails — callers fall back to the plain email.
// Requires the `users:read.email` scope on the notification token.
async function lookupMention(token: string, email: string): Promise<string | null> {
  const key = `${token}:${email.toLowerCase()}`
  const cached = mentionCache.get(key)
  if (cached !== undefined) return cached

  let mention: string | null = null
  try {
    const res = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; user?: { id?: string }; error?: string }
    if (data.ok && data.user?.id) {
      mention = `<@${data.user.id}>`
    } else if (data.error && data.error !== 'users_not_found') {
      console.error(`[slack] users.lookupByEmail failed for ${email}: ${data.error}`)
    }
  } catch (err) {
    console.error(`[slack] users.lookupByEmail failed for ${email}: ${(err as Error).message}`)
  }
  mentionCache.set(key, mention)
  return mention
}

// Sentinel stored in a releasers list meaning "any org member" (mirrors ALL_USERS
// on the client / in modules/migrations). Rendered as plain text, never a mention —
// we must not @-ping the entire team.
const ALL_USERS = '*'

// Turn a list of emails into a display string, replacing each with a Slack mention
// where the email maps to a Slack user and keeping the plain email otherwise. When
// the list is the ALL_USERS sentinel, show a plain label instead of pinging everyone.
async function mentionList(token: string, emails: string[]): Promise<string> {
  if (emails.includes(ALL_USERS)) return 'All Users'
  const resolved = await Promise.all(emails.map(async (e) => (await lookupMention(token, e)) ?? e))
  return resolved.join(', ')
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
  reviewer: ':eyes: *Reviewer added to migration*',
}

const VERB: Record<MigrationEvent, string> = {
  submit: 'Submitted',
  approve: 'Approved',
  apply: 'Applied',
  reviewer: 'Updated',
}

interface MigrationInfo {
  title: string
  description: string | null
  db_name: string
  project_name: string
  env_name: string | null
  // Configured approvers/releasers for the migration's project.
  approvers: string[]
  releasers: string[]
}

async function loadMigrationInfo(migrationId: string): Promise<MigrationInfo | undefined> {
  const row = await queryOne<{
    title: string
    description: string | null
    db_name: string
    project_name: string
    env_name: string | null
    approvers: unknown
    releasers: unknown
  }>(
    `SELECT m.title, m.description, d.name AS db_name, p.name AS project_name, e.name AS env_name,
            COALESCE(pes.approvers, ps.approvers) AS approvers,
            COALESCE(pes.releasers, ps.releasers) AS releasers
       FROM migrations m
       JOIN \`databases\` d ON d.id = m.database_id
       JOIN projects p ON p.id = d.project_id
       LEFT JOIN environments e ON e.id = d.environment_id
       LEFT JOIN project_settings ps ON ps.project_id = p.id
       LEFT JOIN project_env_settings pes ON pes.project_id = p.id AND pes.environment_id = d.environment_id
      WHERE m.id = :id`,
    { id: migrationId },
  )
  if (!row) return undefined
  return { ...row, approvers: asJson<string[]>(row.approvers, []), releasers: asJson<string[]>(row.releasers, []) }
}

// Notify the org's Slack channel about a migration lifecycle event, honoring the
// per-event toggle. No-op when Slack is disabled/unconfigured or the toggle is off.
export async function notifyMigration(
  orgId: string,
  event: MigrationEvent,
  migrationId: string,
  actor: string,
  baseUrl: string,
): Promise<void> {
  const slack = await loadSlack(orgId)
  if (!slack || !slack.enabled || !slack.notification_token || !slack.channel_id) return
  if (!slack[TOGGLE[event]]) return

  const m = await loadMigrationInfo(migrationId)
  if (!m) return

  const reviewers = (await query<{ email: string }>(
    'SELECT reviewer_email AS email FROM migration_reviewers WHERE migration_id = :id',
    { id: migrationId },
  )).map((r) => r.email)

  const verb = VERB[event]
  const lines = [
    LABEL[event],
    `*Project:* ${m.project_name}`,
    `*Environment:* ${m.env_name ?? '—'}`,
    `*Title:* ${m.title}`,
  ]
  if (m.description?.trim()) lines.push(`*Description:* ${m.description.trim()}`)
  lines.push(`*Db:* ${m.db_name}`)
  if (m.approvers.length) lines.push(`*Approvers:* ${await mentionList(slack.notification_token, m.approvers)}`)
  if (m.releasers.length) lines.push(`*Releasers:* ${await mentionList(slack.notification_token, m.releasers)}`)
  if (reviewers.length) lines.push(`*Reviewers:* ${await mentionList(slack.notification_token, reviewers)}`)
  lines.push(`${verb} by ${actor}`)
  lines.push(`<${baseUrl}/migrations/${migrationId}|View migration>`)
  await postMessage(slack, lines.join('\n'))
}
