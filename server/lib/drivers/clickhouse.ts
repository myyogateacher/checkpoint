import { createClient } from '@clickhouse/client'
import { HttpError } from '../http'
import type { ConnectionSecret } from '../../modules/databases.repo'
import type { Column, Driver, TableDef } from './types'

const CONNECT_TIMEOUT_MS = 8_000
const MAX_QUERY_ROWS = 10_000

type ClickHouseJson<T> = {
  meta?: { name: string; type: string }[]
  data?: T[]
  rows?: number
}

type ClickHouseTableRow = {
  schema: string
  name: string
  estimated_rows: number | string | null
  sorting_key: string
  primary_key: string
}

type ClickHouseColumnRow = {
  schema: string
  table_name: string
  name: string
  type: string
  is_in_primary_key: number
  default_expression: string
  default_kind: string
}

function urlFor(c: ConnectionSecret): string {
  // Connection hosts are entered separately from the port, so accepting a URL
  // here would let a host value smuggle a path, credentials or query settings.
  const rawHost = c.host.trim()
  const host = rawHost.replace(/^\[|\]$/g, '')
  const hostname = /^[a-z0-9.-]+$/i.test(host)
  const ipv6 = /^[0-9a-f:.]+$/i.test(host) && host.includes(':')
  if (!host || (!hostname && !ipv6)) {
    throw new HttpError(400, 'ClickHouse host must be a hostname or IP address.')
  }
  const bracketed = ipv6 ? `[${host}]` : host
  return `${c.ssl ? 'https' : 'http'}://${bracketed}:${c.port}`
}

function clientFor(c: ConnectionSecret, timeoutMs = CONNECT_TIMEOUT_MS) {
  return createClient({
    url: urlFor(c),
    database: c.database,
    username: c.username,
    password: c.password,
    request_timeout: timeoutMs,
    max_open_connections: 1,
    keep_alive: { enabled: false },
  })
}

async function withClient<T>(c: ConnectionSecret, work: (client: ReturnType<typeof createClient>) => Promise<T>, timeoutMs?: number): Promise<T> {
  let client: ReturnType<typeof createClient>
  try {
    client = clientFor(c, timeoutMs)
  } catch (err) {
    throw err instanceof HttpError ? err : new HttpError(502, `Could not connect to ${c.host}:${c.port} — ${(err as Error).message}`)
  }
  try {
    return await work(client)
  } catch (err) {
    if (err instanceof HttpError) throw err
    throw new HttpError(502, `Could not connect to ${c.host}:${c.port} — ${(err as Error).message}`)
  } finally {
    await client.close().catch(() => undefined)
  }
}

// Strip quoted strings and comments before looking for statement separators or
// leading keywords. This deliberately mirrors the server's generic SQL guard,
// while keeping ClickHouse-specific read-only rules in this driver.
function codeOnly(sql: string): string {
  let out = ''
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]
    if (c === "'" || c === '"' || c === '`') {
      i++
      for (; i < sql.length; i++) {
        if (sql[i] === '\\') i++
        else if (sql[i] === c) {
          if (sql[i + 1] === c) i++
          else break
        }
      }
      out += ' '
      continue
    }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      out += '\n'
      continue
    }
    if (c === '#' && (i === 0 || /\s/.test(sql[i - 1]))) {
      while (i < sql.length && sql[i] !== '\n') i++
      out += '\n'
      continue
    }
    if (c === '/' && sql[i + 1] === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i++
      out += ' '
      continue
    }
    out += c
  }
  return out
}

export function assertClickHouseReadOnly(sql: string): void {
  const code = codeOnly(sql)
  if (!/^\s*(select|show|describe|desc|with|explain|exists)\b/i.test(code)) {
    throw new HttpError(400, 'Only read-only queries (SELECT / SHOW / DESCRIBE / WITH / EXPLAIN) are allowed.')
  }
  if (/;\s*\S/.test(code)) throw new HttpError(400, 'Only a single statement is allowed.')
  // A CTE can prefix any ClickHouse statement, including INSERT/ALTER/etc. The
  // leading-keyword check above therefore is not enough for WITH. Keep this
  // deliberately conservative: no mutation/control statement may appear in a
  // CTE query after literals and comments have been removed.
  if (/\b(insert|alter|create|drop|rename|truncate|delete|update|optimize|attach|detach|undrop|backup|restore|grant|revoke|kill|system|set|use)\b/i.test(code)) {
    throw new HttpError(400, 'Only read-only queries are allowed.')
  }
  // The client appends its own JSON FORMAT clause. An explicit FORMAT would
  // produce invalid SQL and makes the result shape ambiguous to the UI.
  if (/\bformat\b/i.test(code)) throw new HttpError(400, 'FORMAT clauses are not supported in the read panel.')
  if (/\binto\s+outfile\b/i.test(code)) throw new HttpError(400, 'Writing query results to a file is not allowed.')
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object') : []
}

// Convert the two system-table result sets into Checkpoint's portable schema
// shape. Kept separate from the transport so this contract stays testable
// without a live ClickHouse instance.
export function mapClickHouseIntrospection(tables: unknown, columns: unknown): TableDef[] {
  const columnsByTable = new Map<string, Column[]>()
  for (const col of asRows(columns)) {
    const key = `${String(col.schema)}.${String(col.table_name)}`
    const mapped = columnsByTable.get(key) ?? []
    const type = String(col.type ?? '')
    mapped.push({
      name: String(col.name),
      data_type: type,
      nullable: /^Nullable\(/.test(type),
      default: col.default_expression ? String(col.default_expression) : null,
      is_primary_key: Number(col.is_in_primary_key) === 1,
    })
    columnsByTable.set(key, mapped)
  }
  return asRows(tables).map<TableDef>((table) => {
    const sortingKey = String(table.sorting_key ?? '')
    return {
      name: String(table.name),
      schema: String(table.schema),
      estimated_rows: Number(table.estimated_rows ?? 0),
      columns: columnsByTable.get(`${String(table.schema)}.${String(table.name)}`) ?? [],
      indexes: sortingKey ? [{ name: 'ORDER BY', columns: [sortingKey], unique: false }] : [],
    }
  })
}

// ClickHouse uses independent HTTP requests rather than a transactional session.
// The migration workflow already records a failed run; callers should treat a
// failure after an earlier statement as a partial apply requiring review.
export const clickhouseDriver: Driver = {
  async testConnection(c) {
    const started = Date.now()
    await withClient(c, async (client) => {
      const result = await client.ping({ select: true })
      if (!result.success) throw result.error
    })
    return { latencyMs: Date.now() - started }
  },

  async introspect(c) {
    return withClient(c, async (client) => {
      const [tablesResult, columnsResult] = await Promise.all([
        client.query({
          query: `SELECT database AS schema, name, total_rows AS estimated_rows, sorting_key, primary_key
                    FROM system.tables
                    WHERE is_temporary = 0 AND database = {database_name:String}
                    ORDER BY database, name`,
          format: 'JSON',
          query_params: { database_name: c.database },
        }),
        client.query({
          query: `SELECT database AS schema, table AS table_name, name, type, is_in_primary_key,
                         default_expression, default_kind
                    FROM system.columns
                    WHERE database = {database_name:String}
                    ORDER BY database, table, position`,
          format: 'JSON',
          query_params: { database_name: c.database },
        }),
      ])
      const tableJson = await tablesResult.json<ClickHouseTableRow>() as ClickHouseJson<ClickHouseTableRow>
      const columnJson = await columnsResult.json<ClickHouseColumnRow>() as ClickHouseJson<ClickHouseColumnRow>
      return mapClickHouseIntrospection(tableJson.data, columnJson.data)
    })
  },

  assertReadOnly: assertClickHouseReadOnly,

  async runReadQuery(c, sql, timeoutMs) {
    assertClickHouseReadOnly(sql)
    const started = Date.now()
    return withClient(c, async (client) => {
      try {
        const result = await client.query({
          query: sql,
          format: 'JSON',
          clickhouse_settings: {
            max_execution_time: Math.max(1, Math.ceil(timeoutMs / 1000)),
            max_result_rows: String(MAX_QUERY_ROWS),
            result_overflow_mode: 'break',
          },
        })
        const json = await result.json<Record<string, unknown>>() as ClickHouseJson<Record<string, unknown>>
        const rows = asRows(json.data)
        return { columns: (json.meta ?? []).map((column) => column.name), rows, row_count: rows.length, duration_ms: Date.now() - started }
      } catch (err) {
        throw err instanceof HttpError ? err : new HttpError(400, (err as Error).message)
      }
    }, timeoutMs)
  },

  async applyStatements(c, statements) {
    await withClient(c, async (client) => {
      for (const statement of statements) {
        if (!statement.trim()) throw new HttpError(400, 'Migration statements must not be empty.')
        if (/;\s*\S/.test(codeOnly(statement))) throw new HttpError(400, 'Only a single statement is allowed.')
        try {
          await client.command({ query: statement })
        } catch (err) {
          throw new HttpError(400, (err as Error).message)
        }
      }
    })
  },
}
