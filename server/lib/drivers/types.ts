import type { ConnectionSecret } from '../../modules/databases.repo'

// Tabular result returned to the read panel / Query Studio. Non-tabular stores
// (e.g. Redis) shape their replies into columns + rows so the same UI renders them.
export interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  row_count: number
  duration_ms: number
}

export interface Column {
  name: string
  data_type: string
  nullable: boolean
  default: string | null
  is_primary_key: boolean
}

export interface TableDef {
  name: string
  schema: string
  estimated_rows: number
  columns: Column[]
  indexes: { name: string; columns: string[]; unique: boolean }[]
}

// A per-engine driver. `introspect` and `applyStatements` are optional — engines
// without a schema (Redis) or DDL/migrations simply omit them, and the facade
// surfaces a clear error if they're invoked.
export interface Driver {
  // Validate connectivity and report round-trip latency.
  testConnection(c: ConnectionSecret): Promise<{ latencyMs: number }>
  // Pull schema metadata. Omit for schema-less engines.
  introspect?(c: ConnectionSecret): Promise<TableDef[]>
  // Throw HttpError(400) if the text is not a single read-only statement/command.
  assertReadOnly(queryText: string): void
  // Run a read-only query and return tabular results.
  runReadQuery(c: ConnectionSecret, queryText: string): Promise<QueryResult>
  // Apply ordered write statements (migrations). Omit for engines without DDL.
  applyStatements?(c: ConnectionSecret, statements: string[]): Promise<void>
}
