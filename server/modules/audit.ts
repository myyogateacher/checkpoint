import { type Router, type Ctx, json } from '../lib/http'
import { query } from '../db/pool'
import { requireUser, userOrgIds } from '../lib/auth'
import { iso } from '../lib/serialize'

interface AuditRow {
  id: string
  actor_email: string
  actor_name: string | null
  action: string
  entity_type: string
  entity_id: string | null
  entity_label: string
  summary: string
  created_at: Date
}

export const AUDIT_MAX_LIMIT = 500

// Audit events across the user's organizations, newest first.
export async function listAuditEvents(userId: string, limit = AUDIT_MAX_LIMIT): Promise<AuditRow[]> {
  const orgs = await userOrgIds(userId)
  if (orgs.length === 0) return []
  // LIMIT is interpolated, so clamp it to a positive integer rather than trusting it.
  const capped = Math.min(AUDIT_MAX_LIMIT, Math.max(1, Math.floor(Number(limit) || AUDIT_MAX_LIMIT)))
  return query<AuditRow>(
    `SELECT id, actor_email, actor_name, action, entity_type, entity_id, entity_label, summary, created_at
       FROM audit_logs WHERE org_id IN (${orgs.map(() => '?').join(',')})
      ORDER BY created_at DESC LIMIT ${capped}`,
    orgs,
  )
}

export function toAuditEvent(r: AuditRow) {
  return {
    id: r.id,
    actor_email: r.actor_email,
    actor_name: r.actor_name,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    entity_label: r.entity_label,
    summary: r.summary,
    created_at: iso(r.created_at)!,
  }
}

// System-wide audit log, scoped to the user's organizations.
export function registerAudit(router: Router) {
  router.get('/api/audit-logs', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const rows = await listAuditEvents(user.id)
    return json(rows.map(toAuditEvent))
  })
}
