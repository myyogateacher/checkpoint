import { type Router, type Ctx, json, readJson, badRequest } from '../lib/http'
import { query, execute } from '../db/pool'
import { requireUser } from '../lib/auth'
import { newId } from '../lib/ids'
import { slugify } from '../db/init'
import { iso } from '../lib/serialize'
import { ORG_LOCKED } from '../env'

interface OrgRow {
  id: string
  name: string
  slug: string
  created_at: Date
}
const toOrg = (r: OrgRow) => ({ id: r.id, name: r.name, slug: r.slug, created_at: iso(r.created_at)! })

export function registerOrganizations(router: Router) {
  // Organizations the signed-in user belongs to.
  router.get('/api/organizations', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const rows = await query<OrgRow>(
      `SELECT o.* FROM organizations o JOIN memberships m ON m.org_id = o.id
        WHERE m.user_id = :uid ORDER BY o.created_at`,
      { uid: user.id },
    )
    return json(rows.map(toOrg))
  })

  router.post('/api/organizations', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    if (ORG_LOCKED) throw badRequest('This deployment is bound to a single organization.')
    const { name } = await readJson<{ name?: string }>(ctx.req)
    if (!name?.trim()) throw badRequest('Organization name is required.')
    const id = newId('org')
    await execute('INSERT INTO organizations (id, name, slug) VALUES (:id, :name, :slug)', {
      id,
      name: name.trim(),
      slug: slugify(name) || id,
    })
    await execute('INSERT INTO memberships (org_id, user_id) VALUES (:org, :user)', { org: id, user: user.id })
    const [row] = await query<OrgRow>('SELECT * FROM organizations WHERE id = :id', { id })
    return json(toOrg(row))
  })
}
