import mysql from 'mysql2/promise'
import { HttpError } from './http'
import type { ConnectionSecret } from '../modules/databases.repo'

// Engines that speak the MySQL wire protocol — supported for live introspection
// and query execution today. Other engines need their own drivers (Postgres,
// Snowflake, etc.) and currently return 501.
const MYSQL_PROTO = new Set(['mysql', 'aurora_mysql', 'mariadb', 'tidb', 'starrocks'])

export function supportsLiveAccess(engine: string): boolean {
  return MYSQL_PROTO.has(engine)
}

function notImplemented(engine: string): never {
  throw new HttpError(501, `Live access for ${engine} is not implemented yet (MySQL-family engines are supported).`)
}

async function connect(c: ConnectionSecret) {
  try {
    return await mysql.createConnection({
      host: c.host,
      port: c.port,
      user: c.username,
      password: c.password,
      database: c.database,
      ssl: c.ssl ? { rejectUnauthorized: false } : undefined,
      connectTimeout: 8000,
    })
  } catch (err) {
    throw new HttpError(502, `Could not connect to ${c.host}:${c.port} — ${(err as Error).message}`)
  }
}

interface Column { name: string; data_type: string; nullable: boolean; default: string | null; is_primary_key: boolean }
interface TableDef { name: string; schema: string; estimated_rows: number; columns: Column[]; indexes: { name: string; columns: string[]; unique: boolean }[] }

// Introspect a MySQL-family database into the SchemaSnapshot shape.
export async function introspect(engine: string, c: ConnectionSecret) {
  if (!supportsLiveAccess(engine)) notImplemented(engine)
  const conn = await connect(c)
  try {
    const [tables] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME AS name, TABLE_ROWS AS \`rows\` FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
      [c.database],
    )
    const [cols] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
              COLUMN_DEFAULT AS def, COLUMN_KEY AS ckey
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [c.database],
    )
    const [idx] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME AS t, INDEX_NAME AS name, NON_UNIQUE AS non_unique, COLUMN_NAME AS col, SEQ_IN_INDEX AS seq
         FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
      [c.database],
    )

    const colsByTable = new Map<string, Column[]>()
    for (const r of cols) {
      const arr = colsByTable.get(r.t) ?? []
      arr.push({
        name: r.name,
        data_type: r.type,
        nullable: r.nullable === 'YES',
        default: r.def,
        is_primary_key: r.ckey === 'PRI',
      })
      colsByTable.set(r.t, arr)
    }
    const idxByTable = new Map<string, Map<string, { columns: string[]; unique: boolean }>>()
    for (const r of idx) {
      const t = idxByTable.get(r.t) ?? new Map()
      const e = t.get(r.name) ?? { columns: [], unique: r.non_unique === 0 }
      e.columns.push(r.col)
      t.set(r.name, e)
      idxByTable.set(r.t, t)
    }

    const out: TableDef[] = tables.map((t) => ({
      name: t.name,
      schema: c.database,
      estimated_rows: Number(t.rows ?? 0),
      columns: colsByTable.get(t.name) ?? [],
      indexes: Array.from(idxByTable.get(t.name)?.entries() ?? []).map(([name, v]) => ({ name, columns: v.columns, unique: v.unique })),
    }))
    return out
  } finally {
    await conn.end()
  }
}

// Run a read-only query and return columns + rows.
export async function runReadQuery(engine: string, c: ConnectionSecret, sql: string) {
  if (!supportsLiveAccess(engine)) notImplemented(engine)
  const conn = await connect(c)
  const started = Date.now()
  try {
    const [rows, fields] = await conn.query<mysql.RowDataPacket[]>(sql)
    const columns = (fields ?? []).map((f) => f.name)
    return { columns, rows: rows as Record<string, unknown>[], row_count: rows.length, duration_ms: Date.now() - started }
  } catch (err) {
    throw new HttpError(400, (err as Error).message)
  } finally {
    await conn.end()
  }
}

// Apply DDL/DML statements in order within a transaction.
export async function applyStatements(engine: string, c: ConnectionSecret, statements: string[]): Promise<void> {
  if (!supportsLiveAccess(engine)) notImplemented(engine)
  const conn = await connect(c)
  try {
    await conn.beginTransaction()
    for (const s of statements) await conn.query(s)
    await conn.commit()
  } catch (err) {
    try { await conn.rollback() } catch { /* ignore */ }
    throw new HttpError(400, (err as Error).message)
  } finally {
    await conn.end()
  }
}
