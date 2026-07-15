import { query, queryOne, execute } from '../db/pool'
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

type MigrationEvent = 'submit' | 'approve' | 'apply' | 'reviewer' | 'failed' | 'reject'

const TOGGLE: Record<MigrationEvent, keyof SlackSettings> = {
  submit: 'notify_on_submit',
  approve: 'notify_on_approve',
  apply: 'notify_on_apply',
  reviewer: 'notify_on_reviewer',
  // A failed apply piggybacks the apply toggle; a rejection piggybacks approve —
  // each is the negative outcome of that stage, so the same audience wants both.
  failed: 'notify_on_apply',
  reject: 'notify_on_approve',
}

async function loadSlack(orgId: string): Promise<SlackSettings | null> {
  const row = await queryOne<{ slack: unknown }>('SELECT slack FROM app_settings WHERE org_id = :org', { org: orgId })
  if (!row) return null
  return asJson<SlackSettings>(row.slack, DEFAULTS)
}

// Cache email → resolved Slack user ({id, name}) so we don't hit users.lookupByEmail
// on every notification. Keyed by token so separate workspaces never collide.
// `null` = looked up but no matching Slack user (callers fall back to the email).
const userCache = new Map<string, { id: string; name: string } | null>()

// Resolve an email to a Slack user — `id` for a clickable mention (`<@U…>`), `name`
// for plain-text display (e.g. inside a markdown table where mentions don't render).
// Returns null when the email has no Slack account or the lookup fails. Requires the
// `users:read.email` scope on the notification token.
async function lookupUser(token: string, email: string): Promise<{ id: string; name: string } | null> {
  const key = `${token}:${email.toLowerCase()}`
  const cached = userCache.get(key)
  if (cached !== undefined) return cached

  let user: { id: string; name: string } | null = null
  try {
    const res = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      user?: { id?: string; real_name?: string; name?: string; profile?: { display_name?: string; real_name?: string } }
      error?: string
    }
    if (data.ok && data.user?.id) {
      const p = data.user.profile
      const name = p?.display_name || p?.real_name || data.user.real_name || data.user.name || email
      user = { id: data.user.id, name }
    } else if (data.error && data.error !== 'users_not_found') {
      console.error(`[slack] users.lookupByEmail failed for ${email}: ${data.error}`)
    }
  } catch (err) {
    console.error(`[slack] users.lookupByEmail failed for ${email}: ${(err as Error).message}`)
  }
  userCache.set(key, user)
  return user
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

// One-liner heading for threaded (non-root) replies: `<REPLY> by <actor> · View`.
const REPLY: Record<MigrationEvent, string> = {
  submit: '',
  approve: ':white_check_mark: *Approved*',
  apply: ':rocket: *Applied*',
  reviewer: ':eyes: *Reviewer added*',
  failed: ':x: *Apply failed*',
  reject: ':no_entry_sign: *Rejected*',
}

const VERB: Record<MigrationEvent, string> = {
  submit: 'Submitted',
  approve: 'Approved',
  apply: 'Applied',
  reviewer: 'Updated',
  failed: 'Apply failed',
  reject: 'Rejected',
}

// Reaction (Slack emoji short name, no colons) added to the PARENT "submitted"
// message for each event; null = no reaction. Threading + reactions per PROD-7178.
const REACTION: Record<MigrationEvent, string | null> = {
  submit: null,
  approve: 'white_check_mark',
  apply: 'rocket',
  reviewer: null,
  failed: 'x',
  reject: 'no_entry_sign',
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

// Resolved data the root (submit) notification renders — the actor is already resolved
// to a display name by the caller, so this stays pure and unit-testable.
export interface MigrationBlockInput {
  title: string
  envName: string | null
  dbName: string
  submittedBy: string // plain-text display name (mentions don't render in a md table)
  url: string // link to the migration
  // Deployment migration: marked and typed apart from standard ones (PROD-7464).
  deployGated: boolean
  // Resolved reviewer mentions (<@U…> or plain emails), tagged below the table.
  reviewerMentions: string[]
}

// Section text (and each field) caps at 3000 chars in Block Kit; keep well under.
function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

// Escape a value for a Markdown table cell: `|` breaks columns and newlines break rows.
function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim() || '—'
}

// Pure: build the blocks for the root (submit) notification — a `Title:` heading
// (prefixed `🚢 Deployment -` for deployment migrations), then a Markdown table
// (Environment, Database, Submitted by) and a View link. Uses a `markdown` block
// so Slack renders a bordered grid like the GitHub app's alerts (Block Kit
// `fields` can't draw a real table). Reviewer mentions go in a mrkdwn section
// below the table — mentions only render in mrkdwn.
export function buildMigrationBlocks(input: MigrationBlockInput): unknown[] {
  const md = [
    `${input.deployGated ? '🚢 **Deployment** - ' : ''}**Title:** ${cell(input.title)}`,
    '',
    '| Environment | Database | Submitted by | View |',
    '| --- | --- | --- | --- |',
    `| ${cell(input.envName ?? '—')} | ${cell(input.dbName)} | ${cell(input.submittedBy)} | [View](${input.url}) |`,
  ].join('\n')
  const blocks: unknown[] = [{ type: 'markdown', text: md }]
  if (input.reviewerMentions.length) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `Reviewers: ${input.reviewerMentions.join(' ')}` } })
  return blocks
}

// Pure: build the blocks for a threaded reply (approve/apply/reviewer/failed/reject) —
// a one-liner (`<heading> by <actor> · View`), optionally a `Reason:` line (rejection
// note) and/or a code block with the full error (failed applies).
export function buildThreadReplyBlocks(input: {
  heading: string // REPLY[event], e.g. ':white_check_mark: *Approved*'
  actor: string
  url: string
  error?: string | null // technical error → code block (failed apply)
  note?: string | null // human note → `Reason:` line (rejection reason)
  cc?: string | null // creator mention, cc'd on approve/apply
}): unknown[] {
  let text = `${input.heading} by ${input.actor} · <${input.url}|View migration>`
  if (input.cc) text += `\ncc ${input.cc}`
  const note = input.note?.trim()
  if (note) text += `\n*Reason:* ${truncate(note, 1000)}`
  const blocks: unknown[] = [{ type: 'section', text: { type: 'mrkdwn', text } }]
  const error = input.error?.trim()
  if (error) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `\`\`\`${truncate(error, 2800)}\`\`\`` } })
  return blocks
}

interface MigrationInfo {
  title: string
  description: string | null
  db_name: string
  env_name: string | null
  author_email: string
  deploy_gated: number
  // Slack thread anchor recorded on the submit notification (PROD-7178).
  slack_message_ts: string | null
  slack_channel_id: string | null
}

async function loadMigrationInfo(migrationId: string): Promise<MigrationInfo | undefined> {
  return queryOne<MigrationInfo>(
    `SELECT m.title, d.name AS db_name, e.name AS env_name,
            m.author_email, m.deploy_gated,
            m.slack_message_ts, m.slack_channel_id
       FROM migrations m
       JOIN \`databases\` d ON d.id = m.database_id
       LEFT JOIN environments e ON e.id = d.environment_id
      WHERE m.id = :id`,
    { id: migrationId },
  )
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
  // Resolve the actor once: a clickable mention for thread replies, a plain display
  // name for the markdown table (where `<@U…>` mentions don't render).
  const actorUser = await lookupUser(slack.notification_token, actor)
  const actorMention = actorUser ? `<@${actorUser.id}>` : actor
  const actorName = actorUser?.name ?? actor
  const url = `${baseUrl}/migrations/${migrationId}`

  const plan = notificationPlan(event, m.slack_message_ts)

  // Root: resolve reviewer emails to mentions. Replies: cc the creator on
  // approve/apply, unless they are the actor themselves.
  let reviewerMentions: string[] = []
  if (plan.isRoot) {
    const rows = await query<{ reviewer_email: string }>(
      'SELECT reviewer_email FROM migration_reviewers WHERE migration_id = :id',
      { id: migrationId },
    )
    reviewerMentions = await Promise.all(rows.map(async (r) => {
      const u = await lookupUser(slack.notification_token, r.reviewer_email)
      return u ? `<@${u.id}>` : r.reviewer_email
    }))
  }
  const ccCreator = (event === 'approve' || event === 'apply') && m.author_email !== actor
  const creatorUser = ccCreator ? await lookupUser(slack.notification_token, m.author_email) : null
  const cc = ccCreator ? (creatorUser ? `<@${creatorUser.id}>` : m.author_email) : null

  // Root (submit) is the table; threaded replies are one-liners — with the full error
  // (failed apply) or a reason line (rejection) appended when present.
  const blocks = plan.isRoot
    ? buildMigrationBlocks({
        title: m.title,
        envName: m.env_name,
        dbName: m.db_name,
        submittedBy: actorName,
        url,
        deployGated: !!m.deploy_gated,
        reviewerMentions,
      })
    : buildThreadReplyBlocks({
        heading: REPLY[event],
        actor: actorMention,
        url,
        error: event === 'failed' ? detail : null,
        note: event === 'reject' ? detail : null,
        cc,
      })
  // Plain-text fallback for notifications / accessibility (chat.postMessage wants one
  // even when blocks are present).
  const fallback = `${verb}: ${m.title} (${m.db_name})${m.deploy_gated ? ' · deployment' : ''}`
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
