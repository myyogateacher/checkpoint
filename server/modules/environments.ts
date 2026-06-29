import { type Router, type Ctx, json } from '../lib/http'
import { query } from '../db/pool'
import { requireUser, userOrgIds } from '../lib/auth'

// All environments across the user's organizations (used by Query Studio pickers).
export function registerEnvironments(router: Router) {
  router.get('/api/environments', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const orgs = await userOrgIds(user.id)
    if (orgs.length === 0) return json([])
    const rows = await query<{ id: string; project_id: string; name: string; color: string }>(
      `SELECT e.id, e.project_id, e.name, e.color
         FROM environments e JOIN projects p ON p.id = e.project_id
        WHERE p.org_id IN (${orgs.map(() => '?').join(',')})`,
      orgs,
    )
    return json(rows.map((e) => ({ ...e, database_count: 0 })))
  })
}
