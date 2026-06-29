import type { Ctx } from './http'
import { forbidden, unauthorized } from './http'
import { query } from '../db/pool'
import type { SessionUser, UserRole } from '../types'

export type Capability = 'edit' | 'approve' | 'manage_users'

// Capability matrix — mirrors the client's lib/format.ts `can()`.
export function can(role: UserRole | undefined, capability: Capability): boolean {
  if (!role) return false
  if (role === 'admin') return true
  if (role === 'editor') return capability === 'edit'
  return false
}

export function requireUser(ctx: Ctx): SessionUser {
  if (!ctx.user) throw unauthorized()
  return ctx.user
}

export function requireCapability(ctx: Ctx, capability: Capability): SessionUser {
  const user = requireUser(ctx)
  if (!can(user.role, capability)) throw forbidden('Your role does not permit this action.')
  return user
}

// Organizations the user belongs to.
export async function userOrgIds(userId: string): Promise<string[]> {
  const rows = await query<{ org_id: string }>('SELECT org_id FROM memberships WHERE user_id = :id', { id: userId })
  return rows.map((r) => r.org_id)
}

export async function assertOrgMember(userId: string, orgId: string): Promise<void> {
  const ids = await userOrgIds(userId)
  if (!ids.includes(orgId)) throw forbidden('You are not a member of this organization.')
}

// The user's primary org — used by org-agnostic endpoints (settings, rules).
export async function primaryOrgId(userId: string): Promise<string | null> {
  const ids = await userOrgIds(userId)
  return ids[0] ?? null
}
