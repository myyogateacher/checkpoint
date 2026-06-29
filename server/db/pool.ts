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
