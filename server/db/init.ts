import { execute, queryOne } from './pool'
import { env, ORG_LOCKED } from '../env'
import { newId } from '../lib/ids'

// Add a column only when it's missing, so boots are idempotent on older schemas.
async function ensureColumn(table: string, column: string, alterClause: string): Promise<void> {
  const existing = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = :table AND column_name = :column`,
    { table, column },
  )
  if (!existing || existing.n === 0) {
    await execute(`ALTER TABLE \`${table}\` ${alterClause}`)
  }
}

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

// Apply the schema (idempotent) and ensure the locked org exists when configured.
export async function initDb(): Promise<void> {
  const sql = await Bun.file(`${import.meta.dir}/schema.sql`).text()
  // Split on `;` at end of line — sufficient for this DDL (no procedures).
  const statements = sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--'))
  for (const stmt of statements) {
    await execute(stmt)
  }

  // MySQL has no `ADD COLUMN IF NOT EXISTS`, so guard columns added after the
  // initial release for databases provisioned before this change.
  await ensureColumn('users', 'password_hash', 'ADD COLUMN password_hash TEXT NULL')

  if (ORG_LOCKED) {
    const existing = await queryOne<{ id: string }>('SELECT id FROM organizations WHERE id = :id', { id: 'org_primary' })
    if (!existing) {
      await execute('INSERT INTO organizations (id, name, slug) VALUES (:id, :name, :slug)', {
        id: 'org_primary',
        name: env.lockedOrg,
        slug: slugify(env.lockedOrg) || 'org',
      })
    }
  }

  console.log('Database schema ready.')
}

export const LOCKED_ORG_ID = 'org_primary'
export { slugify, newId }
