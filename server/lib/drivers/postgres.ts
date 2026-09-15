import { Client } from 'pg'
import { HttpError } from '../http'
import type { ConnectionSecret } from '../../modules/databases.repo'
import type { Column, Driver, TableDef } from './types'

// Statements allowed through the read panel, and the single-statement guard.
const READ_ONLY = /^\s*(select|with|explain|show)\b/i

// Schemas that belong to the engine, never to the user.
const SYSTEM_SCHEMAS = "('pg_catalog', 'information_schema', 'pg_internal', 'catalog_history')"

async function connect(c: ConnectionSecret): Promise<Client> {
  const client = new Client({
    host: c.host,
    port: c.port,
    user: c.username,
    password: c.password,
    database: c.database,
    // Redshift refuses plaintext connections on most clusters. rejectUnauthorized is
    // off to match the MySQL driver: these are operator-configured internal hosts,
    // often behind a private endpoint whose cert does not match the CNAME.
    ssl: c.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 8000,
  })
  try {
    await client.connect()
  } catch (err) {
    throw new HttpError(502, `Could not connect to ${c.host}:${c.port} — ${(err as Error).message}`)
  }
  return client
}

// Driver for engines that speak the PostgreSQL wire protocol. Registered against
// Redshift in drivers/index.ts; the Postgres family can be added there when wanted.
//
// Redshift is Postgres-compatible but not Postgres: it has no indexes at all and no
// pg_index to read, so introspect reports none rather than inventing them.
export const postgresDriver: Driver = {
  async testConnection(c) {
    const started = Date.now()
    const client = await connect(c)
    try {
      await client.query('SELECT 1')
    } finally {
      await client.end()
    }
    return { latencyMs: Date.now() - started }
  },

  async introspect(c) {
    const client = await connect(c)
    try {
      const tables = await client.query<{ schema: string; name: string }>(
        `SELECT table_schema AS schema, table_name AS name
           FROM information_schema.tables
          WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ${SYSTEM_SCHEMAS}
          ORDER BY table_schema, table_name`,
      )
      const cols = await client.query<{
        schema: string; t: string; name: string; type: string; nullable: string; def: string | null
      }>(
        `SELECT table_schema AS schema, table_name AS t, column_name AS name,
                data_type AS type, is_nullable AS nullable, column_default AS def
           FROM information_schema.columns
          WHERE table_schema NOT IN ${SYSTEM_SCHEMAS}
          ORDER BY table_schema, table_name, ordinal_position`,
      )
      // Redshift does not enforce primary keys but does record declared ones, and
      // DMS relies on them to apply changes, so they are worth surfacing.
      const pks = await client.query<{ schema: string; t: string; col: string }>(
        `SELECT tc.table_schema AS schema, tc.table_name AS t, kcu.column_name AS col
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_name = tc.constraint_name
            AND kcu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema NOT IN ${SYSTEM_SCHEMAS}`,
      )

      const pkSet = new Set(pks.rows.map((r) => `${r.schema}.${r.t}.${r.col}`))
      const colsByTable = new Map<string, Column[]>()
      for (const r of cols.rows) {
        const key = `${r.schema}.${r.t}`
        const arr = colsByTable.get(key) ?? []
        arr.push({
          name: r.name,
          data_type: r.type,
          nullable: r.nullable === 'YES',
          default: r.def,
          is_primary_key: pkSet.has(`${key}.${r.name}`),
        })
        colsByTable.set(key, arr)
      }

      return tables.rows.map<TableDef>((t) => ({
        name: t.name,
        schema: t.schema,
        // A row count would need a full scan; Redshift does not expose a cheap
        // estimate the way pg_class does. Left at 0 rather than guessed.
        estimated_rows: 0,
        columns: colsByTable.get(`${t.schema}.${t.name}`) ?? [],
        indexes: [],
      }))
    } finally {
      await client.end()
    }
  },

  assertReadOnly(sql) {
    if (!READ_ONLY.test(sql)) throw new HttpError(400, 'Only read-only queries (SELECT / WITH / EXPLAIN / SHOW) are allowed.')
    if (sql.replace(/;\s*$/, '').includes(';')) throw new HttpError(400, 'Only a single statement is allowed.')
  },

  async runReadQuery(c, sql, timeoutMs) {
    this.assertReadOnly(sql)
    const client = await connect(c)
    const started = Date.now()
    try {
      // Server-side cap. Both Postgres and Redshift take statement_timeout in ms.
      await client.query(`SET statement_timeout = ${Math.max(1, Math.round(timeoutMs))}`)
      const res = await client.query(sql)
      const columns = (res.fields ?? []).map((f) => f.name)
      const rows = (res.rows ?? []) as Record<string, unknown>[]
      return { columns, rows, row_count: rows.length, duration_ms: Date.now() - started }
    } catch (err) {
      throw new HttpError(400, (err as Error).message)
    } finally {
      await client.end()
    }
  },

  // Apply statements in order inside a transaction. Unlike MySQL, DDL here is
  // transactional, so a failure part way through rolls the whole set back.
  async applyStatements(c, statements) {
    const client = await connect(c)
    try {
      await client.query('BEGIN')
      for (const s of statements) await client.query(s)
      await client.query('COMMIT')
    } catch (err) {
      try { await client.query('ROLLBACK') } catch { /* ignore */ }
      throw new HttpError(400, (err as Error).message)
    } finally {
      await client.end()
    }
  },
}
