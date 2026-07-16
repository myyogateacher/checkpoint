import { type Router, type Ctx, json, readJson, badRequest, notFound } from '../lib/http'
import { query, queryOne, execute } from '../db/pool'
import { requireUser, primaryOrgId } from '../lib/auth'
import { generateApiToken, parseCreateTokenInput } from '../lib/apiTokens'
import { newId } from '../lib/ids'
import { iso, asJson } from '../lib/serialize'
import { writeAudit } from '../lib/audit'
import type { ApiToken, ApiTokenCreated, ApiTokenScope } from '../types'

// Personal access tokens — session-only by design (a token can never manage tokens), own tokens only.

interface TokenRow {
  id: string
  name: string
  token_prefix: string
  scopes: unknown
  created_at: Date
  expires_at: Date | null
  last_used_at: Date | null
  revoked_at: Date | null
}

const toToken = (r: TokenRow): ApiToken => ({
  id: r.id,
  name: r.name,
  token_prefix: r.token_prefix,
  scopes: asJson<ApiTokenScope[]>(r.scopes, []),
  created_at: iso(r.created_at)!,
  expires_at: iso(r.expires_at),
  last_used_at: iso(r.last_used_at),
  revoked_at: iso(r.revoked_at),
})

export function registerApiTokens(router: Router) {
  router.get('/api/tokens', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const rows = await query<TokenRow>(
      `SELECT id, name, token_prefix, scopes, created_at, expires_at, last_used_at, revoked_at
         FROM api_tokens WHERE user_id = :uid ORDER BY created_at DESC`,
      { uid: user.id },
    )
    return json(rows.map(toToken))
  })

  // Create a token. The full secret is returned once here and never again.
  router.post('/api/tokens', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const body = await readJson<{ name?: string; scopes?: unknown; expires_in_days?: number | null }>(ctx.req)
    const now = new Date()
    const input = parseCreateTokenInput(body, now)
    if ('error' in input) throw badRequest(input.error)

    const { token, hash, prefix } = generateApiToken()
    const id = newId('tok')
    await execute(
      `INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scopes, expires_at, created_at)
       VALUES (:id, :uid, :name, :hash, :prefix, :scopes, :expires, :created)`,
      {
        id,
        uid: user.id,
        name: input.name,
        hash,
        prefix,
        scopes: JSON.stringify(input.scopes),
        expires: input.expiresAt,
        created: now,
      },
    )
    await writeAudit({
      actor: user,
      orgId: await primaryOrgId(user.id),
      action: 'token.create',
      entityType: 'api_token',
      entityId: id,
      entityLabel: input.name,
      summary: `Created API token "${input.name}" (${input.scopes.join(', ')})`,
    })
    const created: ApiTokenCreated = {
      id,
      name: input.name,
      token_prefix: prefix,
      scopes: input.scopes,
      created_at: now.toISOString(),
      expires_at: input.expiresAt?.toISOString() ?? null,
      last_used_at: null,
      revoked_at: null,
      token,
    }
    return json(created)
  })

  // Soft-revoke: the row survives for the audit trail; resolution rejects it.
  router.delete('/api/tokens/:id', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const row = await queryOne<{ id: string; user_id: string; name: string; revoked_at: Date | null }>(
      'SELECT id, user_id, name, revoked_at FROM api_tokens WHERE id = :id',
      { id: ctx.params.id },
    )
    // 404 (not 403) for another user's token so ids can't be probed.
    if (!row || row.user_id !== user.id) throw notFound('Token not found')
    if (!row.revoked_at) {
      await execute('UPDATE api_tokens SET revoked_at = NOW() WHERE id = :id', { id: row.id })
      await writeAudit({
        actor: user,
        orgId: await primaryOrgId(user.id),
        action: 'token.revoke',
        entityType: 'api_token',
        entityId: row.id,
        entityLabel: row.name,
        summary: `Revoked API token "${row.name}"`,
      })
    }
    return new Response(null, { status: 204 })
  })
}
