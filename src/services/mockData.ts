import type {
  AppSettings,
  AuditLogEntry,
  Database,
  DatabaseEngine,
  Environment,
  ManagedUser,
  Migration,
  Organization,
  Project,
  ProjectSettings,
  SavedQuery,
  SchemaSnapshot,
  SessionUser,
} from '../types'
import { LOCKED_ORG_NAME, ORG_LOCKED, slugify } from '../lib/config'

// The current user is a member of every org in this list. In locked mode the
// single org comes from VITE_ORG; otherwise a default org owns the seed data.
const primaryOrgName = ORG_LOCKED ? LOCKED_ORG_NAME : 'Acme Inc'

export const organizations: Organization[] = [
  { id: 'org_primary', name: primaryOrgName, slug: slugify(primaryOrgName) || 'org', created_at: '2025-10-01T00:00:00Z' },
]

// Deterministic seed data backing the stubbed API. The real backend replaces
// this wholesale; the shapes are the contract.

export const currentUser: SessionUser = {
  id: 'u_self',
  email: 'pankaj@myyogateacher.com',
  name: 'Pankaj Soni',
  picture: null,
  role: 'admin',
}

export const projects: Project[] = [
  {
    id: 'p_core',
    org_id: 'org_primary',
    name: 'Core Platform',
    description: 'Primary application databases — users, billing, sessions.',
    tags: ['production', 'pii', 'tier-1'],
    created_at: '2025-11-02T09:00:00Z',
    environment_count: 3,
    database_count: 6,
  },
  {
    id: 'p_analytics',
    org_id: 'org_primary',
    name: 'Analytics',
    description: 'Event pipeline and reporting warehouse.',
    tags: ['warehouse', 'tier-2'],
    created_at: '2026-01-14T12:30:00Z',
    environment_count: 2,
    database_count: 3,
  },
]

export const environments: Environment[] = [
  { id: 'e_core_prod', project_id: 'p_core', name: 'production', color: 'rose', database_count: 3 },
  { id: 'e_core_staging', project_id: 'p_core', name: 'staging', color: 'amber', database_count: 2 },
  { id: 'e_core_dev', project_id: 'p_core', name: 'development', color: 'emerald', database_count: 1 },
  { id: 'e_an_prod', project_id: 'p_analytics', name: 'production', color: 'rose', database_count: 2 },
  { id: 'e_an_staging', project_id: 'p_analytics', name: 'staging', color: 'amber', database_count: 1 },
]

function conn(mode: 'read' | 'write', host: string, port: number, database: string) {
  return {
    id: `c_${mode}_${database}_${host}`,
    mode,
    host,
    port,
    username: mode === 'read' ? 'readonly' : 'migrator',
    database,
    ssl: true,
    has_password: true,
  }
}

export const databases: Database[] = [
  {
    id: 'db_core_prod_main',
    project_id: 'p_core',
    environment_id: 'e_core_prod',
    name: 'app_main',
    engine: 'postgres',
    tags: ['primary', 'pii'],
    read_connection: conn('read', 'prod-pg-replica.internal', 5432, 'app_main'),
    write_connection: conn('write', 'prod-pg-primary.internal', 5432, 'app_main'),
    last_synced_at: '2026-06-24T18:20:00Z',
    table_count: 4,
  },
  {
    id: 'db_core_prod_billing',
    project_id: 'p_core',
    environment_id: 'e_core_prod',
    name: 'billing',
    engine: 'mysql',
    tags: ['billing', 'pci'],
    read_connection: conn('read', 'prod-mysql-replica.internal', 3306, 'billing'),
    write_connection: conn('write', 'prod-mysql-primary.internal', 3306, 'billing'),
    last_synced_at: '2026-06-20T08:05:00Z',
    table_count: 2,
  },
  {
    id: 'db_core_prod_cache',
    project_id: 'p_core',
    environment_id: 'e_core_prod',
    name: 'session_cache',
    engine: 'redis',
    tags: ['cache'],
    read_connection: conn('read', 'prod-redis.internal', 6379, '0'),
    write_connection: conn('write', 'prod-redis.internal', 6379, '0'),
    last_synced_at: null,
    table_count: 0,
  },
  {
    id: 'db_core_staging_main',
    project_id: 'p_core',
    environment_id: 'e_core_staging',
    name: 'app_main',
    engine: 'postgres',
    tags: ['primary'],
    read_connection: conn('read', 'staging-pg.internal', 5432, 'app_main'),
    write_connection: conn('write', 'staging-pg.internal', 5432, 'app_main'),
    last_synced_at: '2026-06-25T07:00:00Z',
    table_count: 4,
  },
  {
    id: 'db_core_staging_billing',
    project_id: 'p_core',
    environment_id: 'e_core_staging',
    name: 'billing',
    engine: 'mysql',
    tags: ['billing'],
    read_connection: conn('read', 'staging-mysql.internal', 3306, 'billing'),
    write_connection: conn('write', 'staging-mysql.internal', 3306, 'billing'),
    last_synced_at: null,
    table_count: 2,
  },
  {
    id: 'db_core_dev_main',
    project_id: 'p_core',
    environment_id: 'e_core_dev',
    name: 'app_main',
    engine: 'postgres',
    tags: ['local'],
    read_connection: conn('read', 'localhost', 5432, 'app_main'),
    write_connection: conn('write', 'localhost', 5432, 'app_main'),
    last_synced_at: '2026-06-25T11:42:00Z',
    table_count: 4,
  },
  {
    id: 'db_an_prod_events',
    project_id: 'p_analytics',
    environment_id: 'e_an_prod',
    name: 'events',
    engine: 'clickhouse',
    tags: ['analytics', 'high-volume'],
    read_connection: conn('read', 'ch-prod.internal', 8123, 'events'),
    write_connection: conn('write', 'ch-prod.internal', 8123, 'events'),
    last_synced_at: '2026-06-23T15:10:00Z',
    table_count: 2,
  },
  {
    id: 'db_an_prod_warehouse',
    project_id: 'p_analytics',
    environment_id: 'e_an_prod',
    name: 'warehouse',
    engine: 'snowflake',
    tags: ['warehouse', 'reporting'],
    read_connection: conn('read', 'acme.snowflakecomputing.com', 443, 'ANALYTICS'),
    write_connection: conn('write', 'acme.snowflakecomputing.com', 443, 'ANALYTICS'),
    last_synced_at: null,
    table_count: 0,
  },
  {
    id: 'db_an_staging_events',
    project_id: 'p_analytics',
    environment_id: 'e_an_staging',
    name: 'events',
    engine: 'clickhouse',
    tags: ['analytics'],
    read_connection: conn('read', 'ch-staging.internal', 8123, 'events'),
    write_connection: conn('write', 'ch-staging.internal', 8123, 'events'),
    last_synced_at: null,
    table_count: 2,
  },
]

export const schemas: Record<string, SchemaSnapshot> = {
  db_core_prod_main: {
    database_id: 'db_core_prod_main',
    synced_at: '2026-06-24T18:20:00Z',
    tables: [
      {
        name: 'users',
        schema: 'public',
        estimated_rows: 184230,
        columns: [
          { name: 'id', data_type: 'bigint', nullable: false, default: "nextval('users_id_seq')", is_primary_key: true },
          { name: 'email', data_type: 'text', nullable: false, default: null, is_primary_key: false },
          { name: 'name', data_type: 'text', nullable: true, default: null, is_primary_key: false },
          { name: 'role', data_type: 'text', nullable: false, default: "'member'", is_primary_key: false },
          { name: 'created_at', data_type: 'timestamptz', nullable: false, default: 'now()', is_primary_key: false },
        ],
        indexes: [
          { name: 'users_pkey', columns: ['id'], unique: true },
          { name: 'users_email_key', columns: ['email'], unique: true },
        ],
      },
      {
        name: 'sessions',
        schema: 'public',
        estimated_rows: 53120,
        columns: [
          { name: 'id', data_type: 'uuid', nullable: false, default: 'gen_random_uuid()', is_primary_key: true },
          { name: 'user_id', data_type: 'bigint', nullable: false, default: null, is_primary_key: false },
          { name: 'expires_at', data_type: 'timestamptz', nullable: false, default: null, is_primary_key: false },
          { name: 'created_at', data_type: 'timestamptz', nullable: false, default: 'now()', is_primary_key: false },
        ],
        indexes: [
          { name: 'sessions_pkey', columns: ['id'], unique: true },
          { name: 'sessions_user_id_idx', columns: ['user_id'], unique: false },
        ],
      },
      {
        name: 'organizations',
        schema: 'public',
        estimated_rows: 4210,
        columns: [
          { name: 'id', data_type: 'bigint', nullable: false, default: null, is_primary_key: true },
          { name: 'name', data_type: 'text', nullable: false, default: null, is_primary_key: false },
          { name: 'plan', data_type: 'text', nullable: false, default: "'free'", is_primary_key: false },
          { name: 'created_at', data_type: 'timestamptz', nullable: false, default: 'now()', is_primary_key: false },
        ],
        indexes: [{ name: 'organizations_pkey', columns: ['id'], unique: true }],
      },
      {
        name: 'memberships',
        schema: 'public',
        estimated_rows: 9850,
        columns: [
          { name: 'org_id', data_type: 'bigint', nullable: false, default: null, is_primary_key: true },
          { name: 'user_id', data_type: 'bigint', nullable: false, default: null, is_primary_key: true },
          { name: 'role', data_type: 'text', nullable: false, default: "'member'", is_primary_key: false },
        ],
        indexes: [{ name: 'memberships_pkey', columns: ['org_id', 'user_id'], unique: true }],
      },
    ],
  },
  db_an_prod_events: {
    database_id: 'db_an_prod_events',
    synced_at: '2026-06-23T15:10:00Z',
    tables: [
      {
        name: 'events',
        schema: 'default',
        estimated_rows: 1284000000,
        columns: [
          { name: 'event_id', data_type: 'UUID', nullable: false, default: null, is_primary_key: false },
          { name: 'event_type', data_type: 'LowCardinality(String)', nullable: false, default: null, is_primary_key: false },
          { name: 'user_id', data_type: 'UInt64', nullable: false, default: null, is_primary_key: false },
          { name: 'occurred_at', data_type: 'DateTime64(3)', nullable: false, default: null, is_primary_key: true },
          { name: 'payload', data_type: 'String', nullable: true, default: null, is_primary_key: false },
        ],
        indexes: [{ name: 'ORDER BY', columns: ['occurred_at', 'event_type'], unique: false }],
      },
      {
        name: 'events_daily_mv',
        schema: 'default',
        estimated_rows: 36500,
        columns: [
          { name: 'day', data_type: 'Date', nullable: false, default: null, is_primary_key: true },
          { name: 'event_type', data_type: 'LowCardinality(String)', nullable: false, default: null, is_primary_key: true },
          { name: 'count', data_type: 'UInt64', nullable: false, default: null, is_primary_key: false },
        ],
        indexes: [{ name: 'ORDER BY', columns: ['day', 'event_type'], unique: false }],
      },
    ],
  },
  db_core_prod_billing: {
    database_id: 'db_core_prod_billing',
    synced_at: '2026-06-20T08:05:00Z',
    tables: [
      {
        name: 'invoices',
        schema: 'billing',
        estimated_rows: 92450,
        columns: [
          { name: 'id', data_type: 'bigint', nullable: false, default: null, is_primary_key: true },
          { name: 'customer_id', data_type: 'bigint', nullable: false, default: null, is_primary_key: false },
          { name: 'amount_cents', data_type: 'int', nullable: false, default: '0', is_primary_key: false },
          { name: 'currency', data_type: 'char(3)', nullable: true, default: null, is_primary_key: false },
          { name: 'status', data_type: 'varchar(16)', nullable: false, default: "'draft'", is_primary_key: false },
          { name: 'created_at', data_type: 'datetime', nullable: false, default: 'CURRENT_TIMESTAMP', is_primary_key: false },
        ],
        indexes: [
          { name: 'PRIMARY', columns: ['id'], unique: true },
          { name: 'invoices_customer_id_idx', columns: ['customer_id'], unique: false },
        ],
      },
      {
        name: 'customers',
        schema: 'billing',
        estimated_rows: 12880,
        columns: [
          { name: 'id', data_type: 'bigint', nullable: false, default: null, is_primary_key: true },
          { name: 'email', data_type: 'varchar(255)', nullable: false, default: null, is_primary_key: false },
          { name: 'name', data_type: 'varchar(255)', nullable: true, default: null, is_primary_key: false },
          { name: 'created_at', data_type: 'datetime', nullable: false, default: 'CURRENT_TIMESTAMP', is_primary_key: false },
        ],
        indexes: [
          { name: 'PRIMARY', columns: ['id'], unique: true },
          { name: 'customers_email_key', columns: ['email'], unique: true },
        ],
      },
    ],
  },
}

export const migrations: Migration[] = [
  {
    id: 'm_001',
    database_id: 'db_core_prod_main',
    database_name: 'app_main',
    engine: 'postgres',
    title: 'Add last_seen_at to users',
    description: 'Track user activity for the inactivity sweep.',
    status: 'pending_approval',
    author_email: 'pankaj@myyogateacher.com',
    reviewers: ['ravi@myyogateacher.com'],
    queries: [
      { id: 'q1', order: 1, sql: 'ALTER TABLE users\n  ADD COLUMN last_seen_at timestamptz;' },
      { id: 'q2', order: 2, sql: 'CREATE INDEX CONCURRENTLY users_last_seen_at_idx\n  ON users (last_seen_at);' },
    ],
    comments: [
      {
        id: 'cm_1',
        author_email: 'ravi@myyogateacher.com',
        author_name: 'Ravi Kumar',
        body: 'Should we run the index creation in a separate migration to avoid a long lock?',
        created_at: '2026-06-25T10:30:00Z',
      },
    ],
    created_at: '2026-06-25T10:15:00Z',
    approved_by: null,
    approved_at: null,
    applied_at: null,
    events: [
      { at: '2026-06-25T10:15:00Z', actor_email: 'pankaj@myyogateacher.com', action: 'created', note: null },
      { at: '2026-06-25T10:16:00Z', actor_email: 'pankaj@myyogateacher.com', action: 'submitted', note: 'Ready for review' },
    ],
  },
  {
    id: 'm_002',
    database_id: 'db_core_prod_billing',
    database_name: 'billing',
    engine: 'mysql',
    title: 'Backfill invoice currency',
    description: 'Default existing invoices to USD before making the column NOT NULL.',
    status: 'applied',
    author_email: 'ravi@myyogateacher.com',
    reviewers: ['pankaj@myyogateacher.com'],
    queries: [
      { id: 'q1', order: 1, sql: "UPDATE invoices SET currency = 'USD' WHERE currency IS NULL;" },
      { id: 'q2', order: 2, sql: 'ALTER TABLE invoices MODIFY currency CHAR(3) NOT NULL;' },
    ],
    comments: [],
    created_at: '2026-06-18T09:00:00Z',
    approved_by: 'pankaj@myyogateacher.com',
    approved_at: '2026-06-18T11:30:00Z',
    applied_at: '2026-06-18T11:35:00Z',
    events: [
      { at: '2026-06-18T09:00:00Z', actor_email: 'ravi@myyogateacher.com', action: 'created', note: null },
      { at: '2026-06-18T09:05:00Z', actor_email: 'ravi@myyogateacher.com', action: 'submitted', note: null },
      { at: '2026-06-18T11:30:00Z', actor_email: 'pankaj@myyogateacher.com', action: 'approved', note: 'LGTM' },
      { at: '2026-06-18T11:35:00Z', actor_email: 'pankaj@myyogateacher.com', action: 'applied', note: '2 statements, 0 errors' },
    ],
  },
  {
    id: 'm_003',
    database_id: 'db_an_prod_events',
    database_name: 'events',
    engine: 'clickhouse',
    title: 'Add session_id to events',
    description: null,
    status: 'draft',
    author_email: 'pankaj@myyogateacher.com',
    reviewers: [],
    queries: [
      { id: 'q1', order: 1, sql: 'ALTER TABLE events\n  ADD COLUMN session_id UUID AFTER user_id;' },
    ],
    comments: [],
    created_at: '2026-06-25T08:00:00Z',
    approved_by: null,
    approved_at: null,
    applied_at: null,
    events: [
      { at: '2026-06-25T08:00:00Z', actor_email: 'pankaj@myyogateacher.com', action: 'created', note: null },
    ],
  },
]

export const users: ManagedUser[] = [
  {
    id: 'u_self',
    email: 'pankaj@myyogateacher.com',
    name: 'Pankaj Soni',
    picture: null,
    role: 'admin',
    last_login_at: '2026-06-25T09:00:00Z',
    is_self: true,
  },
  {
    id: 'u_ravi',
    email: 'ravi@myyogateacher.com',
    name: 'Ravi Kumar',
    picture: null,
    role: 'editor',
    last_login_at: '2026-06-24T17:20:00Z',
    is_self: false,
  },
  {
    id: 'u_meera',
    email: 'meera@myyogateacher.com',
    name: 'Meera Patel',
    picture: null,
    role: 'viewer',
    last_login_at: '2026-06-22T13:00:00Z',
    is_self: false,
  },
]

export const projectSettings: Record<string, ProjectSettings> = {
  p_core: {
    approvers: ['pankaj@myyogateacher.com', 'ravi@myyogateacher.com'],
    releasers: ['pankaj@myyogateacher.com'],
    required_approvals: 2,
  },
  p_analytics: {
    approvers: ['pankaj@myyogateacher.com'],
    releasers: ['pankaj@myyogateacher.com'],
    required_approvals: 1,
  },
}

export const savedQueries: SavedQuery[] = [
  {
    id: 'sq_1',
    name: 'Active users (30d)',
    description: 'Users seen in the last 30 days.',
    tags: ['users', 'analytics'],
    database_id: 'db_core_prod_main',
    database_name: 'app_main',
    engine: 'postgres',
    sql: 'SELECT id, email, role\nFROM users\nWHERE created_at > now() - interval \'30 days\'\nORDER BY created_at DESC;',
    shared: true,
    author_email: 'pankaj@myyogateacher.com',
    created_at: '2026-06-22T09:30:00Z',
  },
  {
    id: 'sq_2',
    name: 'Unpaid invoices',
    description: null,
    tags: ['billing'],
    database_id: 'db_core_prod_billing',
    database_name: 'billing',
    engine: 'mysql',
    sql: "SELECT id, customer_id, amount_cents\nFROM invoices\nWHERE status = 'draft';",
    shared: false,
    author_email: 'ravi@myyogateacher.com',
    created_at: '2026-06-24T14:10:00Z',
  },
]

// Saved validation-rule overrides per engine; empty entries fall back to the
// catalog defaults (see lib/validationRules.ts).
export const validationRules: Partial<Record<DatabaseEngine, import('../lib/validationRules').ValidationSection[]>> = {}

export const settings: AppSettings = {
  email: {
    enabled: true,
    smtp_host: 'smtp.sendgrid.net',
    smtp_port: 587,
    from_address: 'checkpoint@myyogateacher.com',
    username: 'apikey',
    has_password: true,
  },
  slack: {
    enabled: true,
    notification_token: '',
    channel_id: 'C012AB3CD',
    notify_on_submit: true,
    notify_on_approve: false,
    notify_on_apply: true,
  },
  query: {
    default_timeout_seconds: 30,
    format_on_run: true,
  },
}

export const auditLogs: AuditLogEntry[] = [
  {
    id: 'a1',
    actor_email: 'pankaj@myyogateacher.com',
    actor_name: 'Pankaj Soni',
    action: 'migration.submit',
    entity_type: 'migration',
    entity_id: 'm_001',
    entity_label: 'Add last_seen_at to users',
    summary: 'Submitted migration for approval on app_main (production)',
    created_at: '2026-06-25T10:16:00Z',
  },
  {
    id: 'a2',
    actor_email: 'pankaj@myyogateacher.com',
    actor_name: 'Pankaj Soni',
    action: 'schema.sync',
    entity_type: 'database',
    entity_id: null,
    entity_label: 'app_main',
    summary: 'Pulled schema from app_main (development) — 4 tables',
    created_at: '2026-06-25T11:42:00Z',
  },
  {
    id: 'a3',
    actor_email: 'pankaj@myyogateacher.com',
    actor_name: 'Pankaj Soni',
    action: 'migration.apply',
    entity_type: 'migration',
    entity_id: 'm_002',
    entity_label: 'Backfill invoice currency',
    summary: 'Applied migration to billing (production) — 2 statements',
    created_at: '2026-06-18T11:35:00Z',
  },
  {
    id: 'a4',
    actor_email: 'pankaj@myyogateacher.com',
    actor_name: 'Pankaj Soni',
    action: 'user.invite',
    entity_type: 'user',
    entity_id: null,
    entity_label: 'meera@myyogateacher.com',
    summary: 'Invited meera@myyogateacher.com as viewer',
    created_at: '2026-06-15T14:00:00Z',
  },
  {
    id: 'a5',
    actor_email: 'ravi@myyogateacher.com',
    actor_name: 'Ravi Kumar',
    action: 'query.read',
    entity_type: 'database',
    entity_id: null,
    entity_label: 'app_main',
    summary: 'Ran read query on app_main (production) — 50 rows',
    created_at: '2026-06-24T16:05:00Z',
  },
  {
    id: 'a6',
    actor_email: 'ravi@myyogateacher.com',
    actor_name: 'Ravi Kumar',
    action: 'migration.create',
    entity_type: 'migration',
    entity_id: 'm_002',
    entity_label: 'Backfill invoice currency',
    summary: 'Created migration on billing (production)',
    created_at: '2026-06-18T09:00:00Z',
  },
  {
    id: 'a7',
    actor_email: 'pankaj@myyogateacher.com',
    actor_name: 'Pankaj Soni',
    action: 'migration.approve',
    entity_type: 'migration',
    entity_id: 'm_002',
    entity_label: 'Backfill invoice currency',
    summary: 'Approved migration for billing (production)',
    created_at: '2026-06-18T11:30:00Z',
  },
  {
    id: 'a8',
    actor_email: 'pankaj@myyogateacher.com',
    actor_name: 'Pankaj Soni',
    action: 'role.change',
    entity_type: 'user',
    entity_id: null,
    entity_label: 'ravi@myyogateacher.com',
    summary: 'Changed role of ravi@myyogateacher.com from viewer to editor',
    created_at: '2026-06-16T10:20:00Z',
  },
  {
    id: 'a9',
    actor_email: 'pankaj@myyogateacher.com',
    actor_name: 'Pankaj Soni',
    action: 'connection.update',
    entity_type: 'database',
    entity_id: null,
    entity_label: 'app_main',
    summary: 'Updated write connection host for app_main (production)',
    created_at: '2026-06-14T08:45:00Z',
  },
  {
    id: 'a10',
    actor_email: 'pankaj@myyogateacher.com',
    actor_name: 'Pankaj Soni',
    action: 'migration.reject',
    entity_type: 'migration',
    entity_id: null,
    entity_label: 'Drop legacy audit table',
    summary: 'Rejected migration on app_main (production) — "needs a backup first"',
    created_at: '2026-06-12T15:30:00Z',
  },
]
