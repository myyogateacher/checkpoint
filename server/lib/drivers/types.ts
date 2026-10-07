import type { ConnectionSecret } from '../../modules/databases.repo'

// Tabular result returned to the read panel / Query Studio. Non-tabular stores
// (e.g. Redis) shape their replies into columns + rows so the same UI renders them.
export interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  row_count: number
  duration_ms: number
}

// A key-value store's keyspace (Redis) as a folder tree: keys split into
// folders on `/`, `|` and `:`. Counts cover every scanned key; `folders` and
// `keys` are capped per node (`more_*` says how many were left out) so the
// snapshot stays small on large keyspaces.
export interface KeyLeaf {
  key: string
  type: string | null
}
export interface KeyNode {
  name: string
  delimiter: string
  prefix: string
  count: number
  folders: KeyNode[]
  keys: KeyLeaf[]
  more_folders: number
  more_keys: number
}
export interface Keyspace {
  root: KeyNode
  total_keys: number
  // The scan stopped early (key or time cap); counts are partial.
  truncated: boolean
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
  // Run a read-only query and return tabular results. `timeoutMs` bounds how long
  // the statement may run before it is aborted.
  runReadQuery(c: ConnectionSecret, queryText: string, timeoutMs: number): Promise<QueryResult>
  // Engines whose credentials are inherently read/write (Redis has no separate
  // read-only user by default) implement this: the query panel then runs the
  // command on the write connection instead of enforcing `assertReadOnly`.
  // The driver still rejects commands that are unsafe from a panel.
  runCommand?(c: ConnectionSecret, queryText: string, timeoutMs: number): Promise<QueryResult>
  // Scan a key-value keyspace into a folder tree — the "schema" of engines
  // without tables. Omit for engines with tables.
  scanKeyspace?(c: ConnectionSecret): Promise<Keyspace>
  // Apply ordered write statements (migrations). Omit for engines without DDL.
  applyStatements?(c: ConnectionSecret, statements: string[]): Promise<void>
}
