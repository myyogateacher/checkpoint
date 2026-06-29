import { query, queryOne } from '../db/pool'
import { notFound } from '../lib/http'
import { assertOrgMember } from '../lib/auth'
import { asJson, bool, iso } from '../lib/serialize'
import { decryptSecret } from '../lib/crypto'

export interface ConnectionSecret {
  host: string
  port: number
  username: string
  database: string
  ssl: boolean
  password: string
}

// Decrypted connection details for connecting to a managed (external) database.
export async function getConnectionSecret(databaseId: string, mode: 'read' | 'write'): Promise<ConnectionSecret | null> {
  const c = await queryOne<{ host: string; port: number; username: string; db_name: string; ssl: number; password_enc: string | null }>(
    'SELECT host, port, username, db_name, ssl, password_enc FROM connections WHERE database_id = :id AND mode = :mode',
    { id: databaseId, mode },
  )
  if (!c) return null
  return {
    host: c.host,
    port: Number(c.port),
    username: c.username,
    database: c.db_name,
    ssl: bool(c.ssl),
    password: c.password_enc ? decryptSecret(c.password_enc) : '',
  }
}

export interface DbRow {
  id: string
  project_id: string
  environment_id: string
  name: string
  engine: string
  tags: unknown
  last_synced_at: Date | null
  org_id: string
  table_count: number
}

interface ConnRow {
  id: string
  mode: 'read' | 'write'
  host: string
  port: number
  username: string
  db_name: string
  ssl: number
  password_enc: string | null
}

export const DB_SELECT = `
  SELECT d.*, p.org_id,
    COALESCE(JSON_LENGTH(s.payload, '$.tables'), 0) AS table_count
  FROM \`databases\` d
  JOIN projects p ON p.id = d.project_id
  LEFT JOIN schema_snapshots s ON s.database_id = d.id`

// Resolve a database the user may access (membership-checked).
export async function loadDb(userId: string, dbId: string): Promise<DbRow> {
  const row = await queryOne<DbRow>(`${DB_SELECT} WHERE d.id = :id`, { id: dbId })
  if (!row) throw notFound('Database not found')
  await assertOrgMember(userId, row.org_id)
  return row
}

function serializeConn(c: ConnRow) {
  return {
    id: c.id,
    mode: c.mode,
    host: c.host,
    port: Number(c.port),
    username: c.username,
    database: c.db_name,
    ssl: bool(c.ssl),
    has_password: !!c.password_enc,
  }
}

// Build the full Database response (connections, no secrets).
export async function serializeDb(row: DbRow) {
  const conns = await query<ConnRow>('SELECT * FROM connections WHERE database_id = :id', { id: row.id })
  const find = (m: 'read' | 'write') => conns.find((c) => c.mode === m)
  const blank = (m: 'read' | 'write') => ({ id: '', mode: m, host: '', port: 0, username: '', database: '', ssl: true, has_password: false })
  const read = find('read')
  const write = find('write')
  return {
    id: row.id,
    project_id: row.project_id,
    environment_id: row.environment_id,
    name: row.name,
    engine: row.engine,
    tags: asJson<string[]>(row.tags, []),
    read_connection: read ? serializeConn(read) : blank('read'),
    write_connection: write ? serializeConn(write) : blank('write'),
    last_synced_at: iso(row.last_synced_at),
    table_count: Number(row.table_count),
  }
}
