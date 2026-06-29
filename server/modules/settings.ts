import { type Router, type Ctx, json, readJson, badRequest } from '../lib/http'
import { queryOne, execute } from '../db/pool'
import { requireUser, requireCapability, primaryOrgId } from '../lib/auth'
import { asJson } from '../lib/serialize'

// Defaults applied when an org has not configured settings yet.
const DEFAULT_SETTINGS = {
  email: { enabled: false, smtp_host: '', smtp_port: 587, from_address: '', username: '', has_password: false },
  slack: { enabled: false, notification_token: '', channel_id: '', notify_on_submit: true, notify_on_approve: false, notify_on_apply: true },
  query: { default_timeout_seconds: 30, format_on_run: true },
}

export function registerSettings(router: Router) {
  router.get('/api/settings', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const org = await primaryOrgId(user.id)
    if (!org) return json(DEFAULT_SETTINGS)
    const row = await queryOne<{ email: unknown; slack: unknown; query: unknown }>(
      'SELECT email, slack, query FROM app_settings WHERE org_id = :org',
      { org },
    )
    if (!row) return json(DEFAULT_SETTINGS)
    return json({
      email: asJson(row.email, DEFAULT_SETTINGS.email),
      slack: asJson(row.slack, DEFAULT_SETTINGS.slack),
      query: asJson(row.query, DEFAULT_SETTINGS.query),
    })
  })

  router.put('/api/settings', async (ctx: Ctx) => {
    const user = requireCapability(ctx, 'manage_users')
    const org = await primaryOrgId(user.id)
    if (!org) throw badRequest('No organization.')
    const body = await readJson<typeof DEFAULT_SETTINGS>(ctx.req)
    await execute(
      `INSERT INTO app_settings (org_id, email, slack, query) VALUES (:org, :email, :slack, :query)
       ON DUPLICATE KEY UPDATE email = :email, slack = :slack, query = :query`,
      { org, email: JSON.stringify(body.email), slack: JSON.stringify(body.slack), query: JSON.stringify(body.query) },
    )
    return json(body)
  })
}
