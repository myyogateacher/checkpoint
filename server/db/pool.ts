import mysql from 'mysql2/promise'
import { resolveDbConfig } from '../env'

// A single shared connection pool for the whole process.
const cfg = resolveDbConfig()

export const pool = mysql.createPool({
  host: cfg.host,
  port: cfg.port,
  user: cfg.user,
  password: cfg.password,
  database: cfg.database,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  // JSON columns are parsed automatically by mysql2.
})

// Params: positional array or named-placeholder object.
type Params = unknown[] | Record<string, unknown>

export async function query<T = Record<string, unknown>>(sql: string, params?: Params): Promise<T[]> {
  const [rows] = await pool.query(sql, params as never)
  return rows as T[]
}

export async function queryOne<T = Record<string, unknown>>(sql: string, params?: Params): Promise<T | undefined> {
  const rows = await query<T>(sql, params)
  return rows[0]
}

export async function execute(sql: string, params?: Params): Promise<mysql.ResultSetHeader> {
  const [result] = await pool.execute(sql, params as never)
  return result as mysql.ResultSetHeader
}

// A transaction's statement runner — same signature as the module-level `execute`,
// but bound to the transaction's dedicated connection.
export interface Tx {
  execute(sql: string, params?: Params): Promise<mysql.ResultSetHeader>
}

// Run `fn` inside a single transaction on a dedicated pooled connection: commit on
// success, roll back on any throw. Only statements issued through the `tx` handed
// to `fn` take part — the module-level helpers stay on their own connections.
export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    try {
      const result = await fn({
        execute: async (sql, params) => {
          const [res] = await conn.execute(sql, params as never)
          return res as mysql.ResultSetHeader
        },
      })
      await conn.commit()
      return result
    } catch (err) {
      await conn.rollback()
      throw err
    }
  } finally {
    conn.release()
  }
}

// Run a raw, multi-statement SQL script (a schema dump or a migration) in a single
// round trip via a short-lived, dedicated connection with multipleStatements
// enabled — deliberately kept off the shared pool, which stays single-statement to
// avoid stacked-query injection. For trusted, parameter-free SQL only.
export async function execScript(sql: string): Promise<void> {
  const trimmed = sql.trim()
  if (!trimmed) return
  const conn = await mysql.createConnection({ ...cfg, multipleStatements: true })
  try {
    await conn.query(trimmed)
  } finally {
    await conn.end()
  }
}
