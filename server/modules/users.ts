import { type Router, type Ctx, json, readJson, badRequest, forbidden } from '../lib/http'
import { query, queryOne, execute } from '../db/pool'
import { requireCapability, userOrgIds } from '../lib/auth'
import { newId } from '../lib/ids'
import { iso } from '../lib/serialize'
import { writeAudit } from '../lib/audit'
import type { UserRole } from '../types'

interface UserRow {
  id: string
  email: string
  name: string | null
  picture: string | null
  role: UserRole
  last_login_at: Date | null
}

const toUser = (r: UserRow, selfId: string) => ({
  id: r.id,
  email: r.email,
  name: r.name,
  picture: r.picture,
  role: r.role,
  last_login_at: iso(r.last_login_at),
  is_self: r.id === selfId,
})

export function registerUsers(router: Router) {
  // Members of the requester's organizations.
  router.get('/api/users', async (ctx: Ctx) => {
    const user = requireCapability(ctx, 'manage_users')
    const orgs = await userOrgIds(user.id)
    if (orgs.length === 0) return json([toUser({ ...user, last_login_at: null }, user.id)])
    const rows = await query<UserRow>(
      `SELECT DISTINCT u.id, u.email, u.name, u.picture, u.role, u.last_login_at
         FROM users u JOIN memberships m ON m.user_id = u.id
        WHERE m.org_id IN (${orgs.map(() => '?').join(',')}) ORDER BY u.created_at`,
      orgs,
    )
    return json(rows.map((r) => toUser(r, user.id)))
  })

  // Invite a user: create the account (if new) and add them to the inviter's orgs.
  router.post('/api/users', async (ctx: Ctx) => {
    const user = requireCapability(ctx, 'manage_users')
    const { email, role } = await readJson<{ email: string; role: UserRole }>(ctx.req)
    if (!email?.includes('@')) throw badRequest('A valid email is required.')
    const normalized = email.trim().toLowerCase()
    let row = await queryOne<UserRow>('SELECT id, email, name, picture, role, last_login_at FROM users WHERE email = :email', { email: normalized })
    if (!row) {
      const id = newId('u')
      await execute('INSERT INTO users (id, email, role) VALUES (:id, :email, :role)', { id, email: normalized, role })
      row = { id, email: normalized, name: null, picture: null, role, last_login_at: null }
    }
    const orgs = await userOrgIds(user.id)
    for (const org of orgs) {
      await execute('INSERT IGNORE INTO memberships (org_id, user_id) VALUES (:org, :user)', { org, user: row.id })
    }
    await writeAudit({ actor: user, orgId: orgs[0] ?? null, action: 'user.invite', entityType: 'user', entityId: row.id, entityLabel: normalized, summary: `Invited ${normalized} as ${role}` })
    return json(toUser(row, user.id))
  })

  router.patch('/api/users/:id/role', async (ctx: Ctx) => {
    const user = requireCapability(ctx, 'manage_users')
    const { role } = await readJson<{ role: UserRole }>(ctx.req)
    await execute('UPDATE users SET role = :role WHERE id = :id', { role, id: ctx.params.id })
    const row = await queryOne<UserRow>('SELECT id, email, name, picture, role, last_login_at FROM users WHERE id = :id', { id: ctx.params.id })
    if (!row) throw badRequest('Unknown user.')
    await writeAudit({ actor: user, orgId: (await userOrgIds(user.id))[0] ?? null, action: 'role.change', entityType: 'user', entityId: row.id, entityLabel: row.email, summary: `Changed role of ${row.email} to ${role}` })
    return json(toUser(row, user.id))
  })

  router.delete('/api/users/:id', async (ctx: Ctx) => {
    const user = requireCapability(ctx, 'manage_users')
    if (ctx.params.id === user.id) throw forbidden('You cannot remove yourself.')
    const row = await queryOne<{ email: string }>('SELECT email FROM users WHERE id = :id', { id: ctx.params.id })
    await execute('DELETE FROM users WHERE id = :id', { id: ctx.params.id })
    if (row) await writeAudit({ actor: user, orgId: (await userOrgIds(user.id))[0] ?? null, action: 'user.remove', entityType: 'user', entityId: ctx.params.id, entityLabel: row.email, summary: `Removed ${row.email}` })
    return new Response(null, { status: 204 })
  })
}
