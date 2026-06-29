import { type Router, type Ctx, json, readJson, badRequest } from '../lib/http'
import { queryOne, execute } from '../db/pool'
import { requireUser, requireCapability, primaryOrgId } from '../lib/auth'
import { asJson } from '../lib/serialize'
// Reuse the single catalog source of truth shared with the client.
import { rulesForEngine, type ValidationSection } from '../../src/lib/validationRules'
import type { DatabaseEngine } from '../../src/types'

export function registerValidationRules(router: Router) {
  router.get('/api/validation-rules/:engine', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const engine = ctx.params.engine as DatabaseEngine
    const defaults = rulesForEngine(engine)
    const org = await primaryOrgId(user.id)
    if (!org) return json(defaults)
    const row = await queryOne<{ sections: unknown }>(
      'SELECT sections FROM validation_rules WHERE org_id = :org AND engine = :engine',
      { org, engine },
    )
    return json(row ? asJson<ValidationSection[]>(row.sections, defaults) : defaults)
  })

  router.put('/api/validation-rules/:engine', async (ctx: Ctx) => {
    const user = requireCapability(ctx, 'manage_users')
    const org = await primaryOrgId(user.id)
    if (!org) throw badRequest('No organization.')
    const sections = await readJson<ValidationSection[]>(ctx.req)
    await execute(
      `INSERT INTO validation_rules (org_id, engine, sections) VALUES (:org, :engine, :sections)
       ON DUPLICATE KEY UPDATE sections = :sections`,
      { org, engine: ctx.params.engine, sections: JSON.stringify(sections) },
    )
    return json(sections)
  })
}
