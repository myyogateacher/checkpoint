// ---------------------------------------------------------------------------
// Domain model for Checkpoint, the database migration assistant.
// Hierarchy: Project > Environment > Database.
// ---------------------------------------------------------------------------

export type DatabaseEngine = 'postgres' | 'mysql' | 'clickhouse'

export type UserRole = 'admin' | 'editor' | 'viewer'

export type ConnectionMode = 'read' | 'write'

export type MigrationStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'running'
  | 'applied'
  | 'failed'

export interface SessionUser {
  id: string
  email: string
  name: string
  picture: string | null
  role: UserRole
}

export interface SessionState {
  authenticated: boolean
  user: SessionUser | null
}

export interface Project {
  id: string
  name: string
  description: string | null
  tags: string[]
  created_at: string
  environment_count: number
  database_count: number
}

export interface Environment {
  id: string
  project_id: string
  name: string // e.g. "production", "staging"
  color: string // tailwind-ish accent key
  database_count: number
}

export interface Connection {
  id: string
  mode: ConnectionMode
  host: string
  port: number
  username: string
  database: string
  ssl: boolean
  // The secret is never sent to the client; this is a presence flag only.
  has_password: boolean
}

export interface Database {
  id: string
  project_id: string
  environment_id: string
  name: string
  engine: DatabaseEngine
  tags: string[]
  read_connection: Connection
  write_connection: Connection
  last_synced_at: string | null
  table_count: number
}

export interface ConnectionInput {
  host: string
  port: number
  username: string
  database: string
  ssl: boolean
  password: string
}

export interface DatabaseInput {
  project_id: string
  environment_id: string
  name: string
  engine: DatabaseEngine
  tags: string[]
  read: ConnectionInput
  write: ConnectionInput
}

// --- Schema introspection ---------------------------------------------------

export interface ColumnDef {
  name: string
  data_type: string
  nullable: boolean
  default: string | null
  is_primary_key: boolean
}

export interface IndexDef {
  name: string
  columns: string[]
  unique: boolean
}

export interface TableDef {
  name: string
  schema: string
  estimated_rows: number
  columns: ColumnDef[]
  indexes: IndexDef[]
}

export interface SchemaSnapshot {
  database_id: string
  synced_at: string
  tables: TableDef[]
}

// --- Migrations -------------------------------------------------------------

export interface MigrationQuery {
  id: string
  order: number
  sql: string
}

export interface MigrationEvent {
  at: string
  actor_email: string
  action: string // "created" | "submitted" | "approved" | "rejected" | "applied" | "failed"
  note: string | null
}

export interface MigrationComment {
  id: string
  author_email: string
  author_name: string | null
  body: string
  created_at: string
}

export interface Migration {
  id: string
  database_id: string
  database_name: string
  engine: DatabaseEngine
  title: string
  description: string | null
  status: MigrationStatus
  author_email: string
  reviewers: string[]
  queries: MigrationQuery[]
  comments: MigrationComment[]
  created_at: string
  approved_by: string | null
  approved_at: string | null
  applied_at: string | null
  events: MigrationEvent[]
}

// --- Read panel -------------------------------------------------------------

export interface QueryResult {
  columns: string[]
  rows: Array<Record<string, unknown>>
  row_count: number
  duration_ms: number
}

// --- Users & audit ----------------------------------------------------------

export interface ManagedUser {
  id: string
  email: string
  name: string | null
  picture: string | null
  role: UserRole
  last_login_at: string | null
  is_self: boolean
}

// --- Settings ---------------------------------------------------------------

export interface AppSettings {
  email: {
    enabled: boolean
    smtp_host: string
    smtp_port: number
    from_address: string
    username: string
    has_password: boolean
  }
  slack: {
    enabled: boolean
    webhook_url: string
    channel: string
    notify_on_submit: boolean
    notify_on_approve: boolean
    notify_on_apply: boolean
  }
}

export interface AuditLogEntry {
  id: string
  actor_email: string
  actor_name: string | null
  action: string
  entity_type: string
  // Id of the affected entity, when it can be linked to (e.g. a migration).
  entity_id: string | null
  entity_label: string
  summary: string
  created_at: string
}
