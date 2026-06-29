import { type Router, type Ctx, json, readJson, badRequest, notFound } from '../lib/http'
import { query, queryOne, execute } from '../db/pool'
import { requireUser, requireCapability, userOrgIds, assertOrgMember } from '../lib/auth'
import { newId } from '../lib/ids'
import { iso, asJson } from '../lib/serialize'
import { writeAudit } from '../lib/audit'

interface ProjectRow {
  id: string
  org_id: string
  name: string
  description: string | null
  tags: unknown
  created_at: Date
  environment_count: number
  database_count: number
}

function toProject(r: ProjectRow) {
  return {
    id: r.id,
    org_id: r.org_id,
    name: r.name,
    description: r.description,
    tags: asJson<string[]>(r.tags, []),
    created_at: iso(r.created_at)!,
    environment_count: Number(r.environment_count),
    database_count: Number(r.database_count),
  }
}

const PROJECT_SELECT = `
  SELECT p.*,
    (SELECT COUNT(*) FROM environments e WHERE e.project_id = p.id) AS environment_count,
    (SELECT COUNT(*) FROM \`databases\` d WHERE d.project_id = p.id) AS database_count
  FROM projects p`

// Ensure the signed-in user can see this project, returning its row.
async function loadProject(userId: string, id: string): Promise<ProjectRow> {
  const row = await queryOne<ProjectRow>(`${PROJECT_SELECT} WHERE p.id = :id`, { id })
  if (!row) throw notFound('Project not found')
  await assertOrgMember(userId, row.org_id)
  return row
}

export function registerProjects(router: Router) {
  router.get('/api/projects', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    const org = ctx.query.get('org')
    if (org) {
      await assertOrgMember(user.id, org)
      const rows = await query<ProjectRow>(`${PROJECT_SELECT} WHERE p.org_id = :org ORDER BY p.created_at`, { org })
      return json(rows.map(toProject))
    }
    const orgs = await userOrgIds(user.id)
    if (orgs.length === 0) return json([])
    const rows = await query<ProjectRow>(
      `${PROJECT_SELECT} WHERE p.org_id IN (${orgs.map(() => '?').join(',')}) ORDER BY p.created_at`,
      orgs,
    )
    return json(rows.map(toProject))
  })

  router.post('/api/projects', async (ctx: Ctx) => {
    const user = requireCapability(ctx, 'edit')
    const body = await readJson<{ org_id?: string; name?: string; description?: string; tags?: string[] }>(ctx.req)
    if (!body.org_id || !body.name?.trim()) throw badRequest('org_id and name are required.')
    await assertOrgMember(user.id, body.org_id)
    const id = newId('p')
    await execute(
      'INSERT INTO projects (id, org_id, name, description, tags) VALUES (:id, :org, :name, :description, :tags)',
      { id, org: body.org_id, name: body.name.trim(), description: body.description ?? null, tags: JSON.stringify(body.tags ?? []) },
    )
    await writeAudit({ actor: user, orgId: body.org_id, action: 'project.create', entityType: 'project', entityId: id, entityLabel: body.name.trim(), summary: `Created project ${body.name.trim()}` })
    const row = await queryOne<ProjectRow>(`${PROJECT_SELECT} WHERE p.id = :id`, { id })
    return json(toProject(row!))
  })

  router.get('/api/projects/:id', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    return json(toProject(await loadProject(user.id, ctx.params.id)))
  })

  // Environments for a project.
  router.get('/api/projects/:id/environments', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    await loadProject(user.id, ctx.params.id)
    const rows = await query<{ id: string; project_id: string; name: string; color: string }>(
      'SELECT id, project_id, name, color FROM environments WHERE project_id = :id ORDER BY created_at',
      { id: ctx.params.id },
    )
    const withCounts = await Promise.all(
      rows.map(async (e) => {
        const [{ n }] = await query<{ n: number }>('SELECT COUNT(*) AS n FROM `databases` WHERE environment_id = :id', { id: e.id })
        return { ...e, database_count: Number(n) }
      }),
    )
    return json(withCounts)
  })

  // Per-project governance (approvers / releasers / required approvals).
  router.get('/api/projects/:id/settings', async (ctx: Ctx) => {
    const user = requireUser(ctx)
    await loadProject(user.id, ctx.params.id)
    const row = await queryOne<{ approvers: unknown; releasers: unknown; required_approvals: number }>(
      'SELECT approvers, releasers, required_approvals FROM project_settings WHERE project_id = :id',
      { id: ctx.params.id },
    )
    return json(
      row
        ? { approvers: asJson<string[]>(row.approvers, []), releasers: asJson<string[]>(row.releasers, []), required_approvals: Number(row.required_approvals) }
        : { approvers: [], releasers: [], required_approvals: 1 },
    )
  })

  router.put('/api/projects/:id/settings', async (ctx: Ctx) => {
    const user = requireCapability(ctx, 'manage_users')
    const project = await loadProject(user.id, ctx.params.id)
    const body = await readJson<{ approvers: string[]; releasers: string[]; required_approvals: number }>(ctx.req)
    await execute(
      `INSERT INTO project_settings (project_id, approvers, releasers, required_approvals)
       VALUES (:id, :approvers, :releasers, :req)
       ON DUPLICATE KEY UPDATE approvers = :approvers, releasers = :releasers, required_approvals = :req`,
      { id: ctx.params.id, approvers: JSON.stringify(body.approvers ?? []), releasers: JSON.stringify(body.releasers ?? []), req: body.required_approvals ?? 1 },
    )
    await writeAudit({ actor: user, orgId: project.org_id, action: 'project.settings', entityType: 'project', entityId: project.id, entityLabel: project.name, summary: `Updated migration governance for ${project.name}` })
    return json(body)
  })
}
