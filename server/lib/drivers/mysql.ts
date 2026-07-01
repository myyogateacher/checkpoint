import mysql from 'mysql2/promise'
import { HttpError } from '../http'
import type { ConnectionSecret } from '../../modules/databases.repo'
import type { Column, Driver, TableDef } from './types'

// Statements allowed through the read panel, and the single-statement guard.
const READ_ONLY = /^\s*(select|show|with|explain)\b/i

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

// Driver for engines that speak the MySQL wire protocol (MySQL, Aurora MySQL,
// MariaDB, TiDB, StarRocks). Registered against each in drivers/index.ts.
export const mysqlDriver: Driver = {
  // Open a connection, run a trivial probe, and report round-trip latency.
  async testConnection(c) {
    const started = Date.now()
    const conn = await connect(c)
    try {
      await conn.query('SELECT 1')
    } finally {
      await conn.end()
    }
    return { latencyMs: Date.now() - started }
  },

  // Introspect a MySQL-family database into the SchemaSnapshot shape.
  async introspect(c) {
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
  },

  assertReadOnly(sql) {
    if (!READ_ONLY.test(sql)) throw new HttpError(400, 'Only read-only queries (SELECT / SHOW / WITH / EXPLAIN) are allowed.')
    if (sql.replace(/;\s*$/, '').includes(';')) throw new HttpError(400, 'Only a single statement is allowed.')
  },

  // Run a read-only query and return columns + rows, bounded by timeoutMs.
  async runReadQuery(c, sql, timeoutMs) {
    this.assertReadOnly(sql)
    const conn = await connect(c)
    const started = Date.now()
    try {
      // Server-side cap for SELECTs (best-effort — ignored by engines/versions
      // without max_execution_time), plus a client-side timeout that aborts the
      // socket for anything still running (e.g. SHOW / slow network).
      try {
        await conn.query('SET SESSION max_execution_time = ?', [timeoutMs])
      } catch { /* not supported on this engine/version — rely on the client timeout */ }
      const [rows, fields] = await conn.query<mysql.RowDataPacket[]>({ sql, timeout: timeoutMs })
      const columns = (fields ?? []).map((f) => f.name)
      return { columns, rows: rows as Record<string, unknown>[], row_count: rows.length, duration_ms: Date.now() - started }
    } catch (err) {
      const msg = (err as Error & { code?: string }).code === 'PROTOCOL_SEQUENCE_TIMEOUT'
        ? `Query exceeded the ${Math.round(timeoutMs / 1000)}s timeout.`
        : (err as Error).message
      throw new HttpError(400, msg)
    } finally {
      await conn.end()
    }
  },

  // Apply DDL/DML statements in order within a transaction.
  async applyStatements(c, statements) {
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
  },
}
