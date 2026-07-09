import { queryOne, execute } from '../db/pool'
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

type MigrationEvent = 'submit' | 'approve' | 'apply' | 'reviewer' | 'failed'

const TOGGLE: Record<MigrationEvent, keyof SlackSettings> = {
  submit: 'notify_on_submit',
  approve: 'notify_on_approve',
  apply: 'notify_on_apply',
  reviewer: 'notify_on_reviewer',
  // A failed apply piggybacks the apply toggle — same audience wants both outcomes.
  failed: 'notify_on_apply',
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

// Post a message to a Slack channel via chat.postMessage (defaults to the org's
// configured channel; pass opts.channel to override, e.g. a thread's own channel).
// Pass opts.threadTs to reply in-thread, opts.blocks to render Block Kit (text stays
// as the notification/accessibility fallback). Returns { ts, channel } on success (the
// anchor used for threading and reactions) or null on any failure. Notifications are
// best-effort: failures are logged and swallowed so they never break the migration
// request that triggered them.
async function postMessage(
  slack: SlackSettings,
  text: string,
  opts: { threadTs?: string | null; channel?: string; blocks?: unknown[] } = {},
): Promise<{ ts: string; channel: string } | null> {
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${slack.notification_token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel: opts.channel ?? slack.channel_id,
        text,
        ...(opts.blocks ? { blocks: opts.blocks } : {}),
        ...(opts.threadTs ? { thread_ts: opts.threadTs } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; ts?: string; channel?: string }
    if (!data.ok || !data.ts || !data.channel) {
      console.error(`[slack] chat.postMessage failed: ${data.error ?? `HTTP ${res.status}`}`)
      return null
    }
    return { ts: data.ts, channel: data.channel }
  } catch (err) {
    console.error(`[slack] notification failed: ${(err as Error).message}`)
    return null
  }
}

// Add an emoji reaction (Slack short name, no colons) to a message. Best-effort:
// failures are logged and swallowed, and `already_reacted` counts as success.
// Requires the `reactions:write` scope on the notification token.
export async function addReaction(slack: SlackSettings, channel: string, ts: string, name: string): Promise<void> {
  try {
    const res = await fetch('https://slack.com/api/reactions.add', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${slack.notification_token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel, timestamp: ts, name }),
      signal: AbortSignal.timeout(8000),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!data.ok && data.error !== 'already_reacted') {
      console.error(`[slack] reactions.add failed: ${data.error ?? `HTTP ${res.status}`}`)
    }
  } catch (err) {
    console.error(`[slack] reactions.add failed: ${(err as Error).message}`)
  }
}

// Heading for the root (submit) table message.
const LABEL: Record<MigrationEvent, string> = {
  submit: ':large_yellow_circle: *Migration submitted for approval*',
  approve: ':white_check_mark: *Migration approved*',
  apply: ':rocket: *Migration applied*',
  reviewer: ':eyes: *Reviewer added to migration*',
  failed: ':x: *Migration apply failed*',
}

// One-liner heading for threaded (non-root) replies: `<REPLY> by <actor> · View`.
const REPLY: Record<MigrationEvent, string> = {
  submit: '',
  approve: ':white_check_mark: *Approved*',
  apply: ':rocket: *Applied*',
  reviewer: ':eyes: *Reviewer added*',
  failed: ':x: *Apply failed*',
}

const VERB: Record<MigrationEvent, string> = {
  submit: 'Submitted',
  approve: 'Approved',
  apply: 'Applied',
  reviewer: 'Updated',
  failed: 'Apply failed',
}

// Reaction (Slack emoji short name, no colons) added to the PARENT "submitted"
// message for each event; null = no reaction. Threading + reactions per PROD-7178.
const REACTION: Record<MigrationEvent, string | null> = {
  submit: null,
  approve: 'white_check_mark',
  apply: 'rocket',
  reviewer: null,
  failed: 'x',
}

// How a lifecycle notification relates to the migration's Slack thread.
export interface NotificationPlan {
  // `submit` is the thread root — the posted message's ts becomes the anchor.
  isRoot: boolean
  // Reply under this parent ts, or null to post top-level (unknown anchor).
  threadTs: string | null
  // React on the parent with this emoji, or null for none.
  reaction: string | null
}

// Pure policy: given an event and the migration's stored anchor ts, decide whether
// this notification is the thread root, what it threads under, and what it reacts
// with. With no anchor (submit was disabled/never sent/failed), threadTs is null and
// the caller falls back to a top-level post.
export function notificationPlan(event: MigrationEvent, storedTs: string | null): NotificationPlan {
  const isRoot = event === 'submit'
  return {
    isRoot,
    threadTs: isRoot ? null : storedTs,
    reaction: REACTION[event],
  }
}

// Resolved data a migration notification renders — mentions/actor already resolved to
// display strings by the caller, so this stays pure and unit-testable.
export interface MigrationBlockInput {
  label: string // event heading mrkdwn (emoji + bold), e.g. LABEL['submit']
  title: string
  description: string | null
  envName: string | null
  dbName: string
  releasers: string // resolved mention list; '' when there are none
  verb: string // Submitted / Approved / Applied / Updated
  actor: string // resolved mention, or plain email when not on Slack
  url: string // link to the migration
}

// Section text (and each field) caps at 3000 chars in Block Kit; keep well under.
function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

// Pure: build the Block Kit blocks for a migration notification — a heading + title,
// a 2-column fields grid (Environment, Database, and Releasers when present), an
// optional description, and a context line with the actor mention and View link.
export function buildMigrationBlocks(input: MigrationBlockInput): unknown[] {
  const fields = [
    { type: 'mrkdwn', text: `*Environment:*\n${input.envName ?? '—'}` },
    { type: 'mrkdwn', text: `*Database:*\n${input.dbName}` },
  ]
  if (input.releasers.trim()) fields.push({ type: 'mrkdwn', text: `*Releasers:*\n${input.releasers}` })

  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: `${input.label}\n*${input.title}*` } },
    { type: 'section', fields: fields.slice(0, 10) },
  ]

  const description = input.description?.trim()
  if (description) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Description:*\n${truncate(description, 2900)}` } })
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `${input.verb} by ${input.actor} · <${input.url}|View migration>` }],
  })
  return blocks
}

// Pure: build the blocks for a threaded reply (approve/apply/reviewer/failed) — a
// single one-liner (`<heading> by <actor> · View`), plus a code block with the full
// error when one is given (failed applies).
export function buildThreadReplyBlocks(input: {
  heading: string // REPLY[event], e.g. ':white_check_mark: *Approved*'
  actor: string
  url: string
  error?: string | null
}): unknown[] {
  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: `${input.heading} by ${input.actor} · <${input.url}|View migration>` } },
  ]
  const error = input.error?.trim()
  if (error) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `\`\`\`${truncate(error, 2800)}\`\`\`` } })
  return blocks
}

interface MigrationInfo {
  title: string
  description: string | null
  db_name: string
  env_name: string | null
  // Configured releasers for the migration's project (shown in the notification).
  releasers: string[]
  // Slack thread anchor recorded on the submit notification (PROD-7178).
  slack_message_ts: string | null
  slack_channel_id: string | null
}

async function loadMigrationInfo(migrationId: string): Promise<MigrationInfo | undefined> {
  const row = await queryOne<{
    title: string
    description: string | null
    db_name: string
    env_name: string | null
    releasers: unknown
    slack_message_ts: string | null
    slack_channel_id: string | null
  }>(
    `SELECT m.title, m.description, d.name AS db_name, e.name AS env_name,
            m.slack_message_ts, m.slack_channel_id,
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
  return { ...row, releasers: asJson<string[]>(row.releasers, []) }
}

// Notify the org's Slack channel about a migration lifecycle event, honoring the
// per-event toggle. No-op when Slack is disabled/unconfigured or the toggle is off.
export async function notifyMigration(
  orgId: string,
  event: MigrationEvent,
  migrationId: string,
  actor: string,
  baseUrl: string,
  detail?: string | null,
): Promise<void> {
  const slack = await loadSlack(orgId)
  if (!slack || !slack.enabled || !slack.notification_token || !slack.channel_id) return
  if (!slack[TOGGLE[event]]) return

  const m = await loadMigrationInfo(migrationId)
  if (!m) return

  const verb = VERB[event]
  // Actor renders as a Slack mention when their email maps to a Slack user, else plain.
  const actorMention = (await lookupMention(slack.notification_token, actor)) ?? actor
  const url = `${baseUrl}/migrations/${migrationId}`

  const plan = notificationPlan(event, m.slack_message_ts)

  // Root (submit) carries the full table; threaded replies are one-liners (plus the
  // full error in a code block for a failed apply).
  const blocks = plan.isRoot
    ? buildMigrationBlocks({
        label: LABEL[event],
        title: m.title,
        description: m.description,
        envName: m.env_name,
        dbName: m.db_name,
        releasers: m.releasers.length ? await mentionList(slack.notification_token, m.releasers) : '',
        verb,
        actor: actorMention,
        url,
      })
    : buildThreadReplyBlocks({ heading: REPLY[event], actor: actorMention, url, error: detail })
  // Plain-text fallback for notifications / accessibility (chat.postMessage wants one
  // even when blocks are present).
  const fallback = `${verb}: ${m.title} (${m.db_name})`
  // Reply in the parent's own channel (kept alongside its ts) so a later change to
  // the configured channel can't orphan the thread. Root/fallback posts (no anchor)
  // go to the current channel.
  const channel = plan.threadTs ? (m.slack_channel_id ?? undefined) : undefined
  const posted = await postMessage(slack, fallback, { threadTs: plan.threadTs, channel, blocks })

  // The "submitted" message anchors the thread — remember its ts + channel so later
  // approve/apply/reviewer notifications reply under it and react on it.
  if (plan.isRoot && posted) {
    await execute('UPDATE migrations SET slack_message_ts = :ts, slack_channel_id = :ch WHERE id = :id', {
      ts: posted.ts, ch: posted.channel, id: migrationId,
    })
  }

  // React on the parent (submitted) message when the event calls for it and the
  // anchor is known. Independent of the reply above — best-effort, no scope → no-op.
  if (plan.reaction && m.slack_message_ts && m.slack_channel_id) {
    await addReaction(slack, m.slack_channel_id, m.slack_message_ts, plan.reaction)
  }
}
