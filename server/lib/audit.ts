import { execute } from '../db/pool'
import { newId } from './ids'
import type { SessionUser } from '../types'

// Append an immutable audit entry. `action` follows the `entity.verb` convention
// the client uses to categorize the audit log (e.g. migration.apply, query.read).
export async function writeAudit(opts: {
  actor: SessionUser
  orgId: string | null
  action: string
  entityType: string
  entityId?: string | null
  entityLabel: string
  summary: string
}): Promise<void> {
  await execute(
    `INSERT INTO audit_logs (id, org_id, actor_email, actor_name, action, entity_type, entity_id, entity_label, summary)
     VALUES (:id, :org_id, :actor_email, :actor_name, :action, :entity_type, :entity_id, :entity_label, :summary)`,
    {
      id: newId('a'),
      org_id: opts.orgId,
      actor_email: opts.actor.email,
      actor_name: opts.actor.name,
      action: opts.action,
      entity_type: opts.entityType,
      entity_id: opts.entityId ?? null,
      entity_label: opts.entityLabel,
      summary: opts.summary,
    },
  )
}
