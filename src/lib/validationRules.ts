import type { DatabaseEngine } from '../types'
import { engineSupportsMigrations } from './engines'

// ---------------------------------------------------------------------------
// Validation rules catalog. Rules are pure data (serializable) so they can be
// toggled/configured and persisted. A separate checker map (RULE_CHECKERS)
// holds the logic used to pre-validate migration SQL.
// ---------------------------------------------------------------------------

export interface ValidationRule {
  id: string
  title: string
  description: string
  example?: string
  // Optional configurable value (e.g. a threshold). `currentValue` overrides default.
  value?: { default: string; unit?: string }
  currentValue?: string
  enabled: boolean
}

export interface ValidationSection {
  id: string
  title: string
  enabled: boolean
  rules: ValidationRule[]
}

type Profile = 'postgres' | 'mysql' | 'oracle' | 'sqlserver' | 'clickhouse' | 'warehouse' | 'cassandra'

const ENGINE_PROFILE: Record<string, Profile> = {
  postgres: 'postgres',
  aurora_postgres: 'postgres',
  alloydb: 'postgres',
  redshift: 'postgres',
  mysql: 'mysql',
  aurora_mysql: 'mysql',
  mariadb: 'mysql',
  tidb: 'mysql',
  starrocks: 'mysql',
  oracle: 'oracle',
  sqlserver: 'sqlserver',
  clickhouse: 'clickhouse',
  snowflake: 'warehouse',
  bigquery: 'warehouse',
  databricks: 'warehouse',
  hive: 'warehouse',
  cassandra: 'cassandra',
}

// --- Shared sections --------------------------------------------------------

function safetySection(): ValidationSection {
  return {
    id: 'safety',
    title: 'Safety',
    enabled: true,
    rules: [
      {
        id: 'drop-if-exists',
        title: 'Guard DROP with IF EXISTS',
        description: 'DROP statements must use IF EXISTS so re-running a migration is idempotent.',
        example: 'DROP TABLE IF EXISTS legacy_users;',
        enabled: true,
      },
      {
        id: 'no-drop-database',
        title: 'Disallow dropping databases/schemas',
        description: 'Block DROP DATABASE and DROP SCHEMA — far too destructive for a migration.',
        enabled: true,
      },
      {
        id: 'no-truncate',
        title: 'Disallow TRUNCATE',
        description: 'TRUNCATE is destructive and often non-transactional.',
        enabled: false,
      },
      {
        id: 'guard-update-delete',
        title: 'Require WHERE on UPDATE / DELETE',
        description: 'An UPDATE or DELETE without a WHERE clause rewrites every row.',
        example: "UPDATE invoices SET currency = 'USD' WHERE currency IS NULL;",
        enabled: true,
      },
    ],
  }
}

function limitsSection(): ValidationSection {
  return {
    id: 'limits',
    title: 'Limits & review',
    enabled: true,
    rules: [
      {
        id: 'max-statements',
        title: 'Limit statements per migration',
        description: 'Keep migrations small and reviewable; large batches are split.',
        value: { default: '20', unit: 'statements' },
        enabled: true,
      },
      {
        id: 'require-description',
        title: 'Require a description',
        description: 'Every migration must explain its intent for reviewers.',
        enabled: false,
      },
    ],
  }
}

function conventionsSection(): ValidationSection {
  return {
    id: 'conventions',
    title: 'Conventions',
    enabled: true,
    rules: [
      {
        id: 'snake-case',
        title: 'snake_case identifiers',
        description: 'New tables and columns should be lower snake_case.',
        example: 'CREATE TABLE user_sessions (...);',
        enabled: true,
      },
      {
        id: 'not-null-default',
        title: 'NOT NULL columns need a default',
        description: 'Adding a NOT NULL column without a default fails on populated tables.',
        example: "ADD COLUMN status text NOT NULL DEFAULT 'active';",
        enabled: true,
      },
    ],
  }
}

// --- Per-profile performance/locking section --------------------------------

const PERFORMANCE: Record<Profile, ValidationRule[]> = {
  postgres: [
    {
      id: 'pg-concurrent-index',
      title: 'Create indexes CONCURRENTLY',
      description: 'Building an index without CONCURRENTLY takes a write lock on the table.',
      example: 'CREATE INDEX CONCURRENTLY users_email_idx ON users (email);',
      enabled: true,
    },
    {
      id: 'lock-timeout',
      title: 'Set a lock timeout',
      description: 'Fail fast instead of queueing behind long-running transactions.',
      value: { default: '5s' },
      enabled: true,
    },
    {
      id: 'pg-avoid-rewrite',
      title: 'Avoid full-table rewrites',
      description: 'Some ALTER COLUMN TYPE changes rewrite the whole table while locked.',
      enabled: false,
    },
  ],
  mysql: [
    {
      id: 'mysql-online-ddl',
      title: 'Use online DDL',
      description: 'Prefer ALGORITHM=INPLACE/INSTANT or pt-online-schema-change for large tables.',
      example: 'ALTER TABLE orders ADD COLUMN note text, ALGORITHM=INPLACE, LOCK=NONE;',
      enabled: true,
    },
    {
      id: 'mysql-utf8mb4',
      title: 'Use utf8mb4 charset',
      description: 'New text columns/tables should use utf8mb4 (full Unicode).',
      enabled: true,
    },
    { id: 'lock-timeout', title: 'Set a lock wait timeout', description: 'Avoid blocking on metadata locks indefinitely.', value: { default: '5s' }, enabled: true },
  ],
  oracle: [
    { id: 'oracle-online', title: 'Use ONLINE for index DDL', description: 'CREATE/ALTER INDEX … ONLINE avoids blocking DML.', example: 'CREATE INDEX emp_idx ON emp (dept_id) ONLINE;', enabled: true },
    { id: 'oracle-no-long-alter', title: 'Avoid long ALTER on large tables', description: 'Use online redefinition (DBMS_REDEFINITION) for big changes.', enabled: false },
  ],
  sqlserver: [
    { id: 'mssql-online', title: 'Use WITH (ONLINE = ON)', description: 'Online index operations avoid blocking on Enterprise edition.', example: 'CREATE INDEX ix_users_email ON users (email) WITH (ONLINE = ON);', enabled: true },
    { id: 'lock-timeout', title: 'Set a lock timeout', description: 'SET LOCK_TIMEOUT to fail fast on blocking.', value: { default: '5000ms' }, enabled: true },
  ],
  clickhouse: [
    { id: 'ch-on-cluster', title: 'Run DDL ON CLUSTER', description: 'Distributed DDL should target the cluster, not a single node.', example: 'ALTER TABLE events ON CLUSTER main ADD COLUMN session_id UUID;', enabled: true },
    { id: 'ch-no-optimize-final', title: 'Avoid OPTIMIZE … FINAL', description: 'OPTIMIZE FINAL in a migration can be extremely expensive.', enabled: true },
  ],
  warehouse: [
    { id: 'wh-no-row-updates', title: 'Avoid row-level UPDATE/DELETE', description: 'Warehouses are columnar — prefer set-based loads over row mutations.', enabled: true },
    { id: 'wh-cluster-keys', title: 'Define partition/cluster keys', description: 'Large tables should declare clustering/partitioning for scan pruning.', enabled: false },
  ],
  cassandra: [
    { id: 'cql-no-allow-filtering', title: 'Disallow ALLOW FILTERING', description: 'ALLOW FILTERING scans the whole table — model the query instead.', enabled: true },
    { id: 'cql-no-alter-clustering', title: "Don't alter clustering columns", description: 'Changing primary/clustering keys requires a new table + backfill.', enabled: true },
  ],
}

export function rulesForEngine(engine: DatabaseEngine): ValidationSection[] {
  const profile = ENGINE_PROFILE[engine] ?? 'postgres'
  return [
    safetySection(),
    { id: 'performance', title: 'Performance & locking', enabled: true, rules: PERFORMANCE[profile].map((r) => ({ ...r })) },
    limitsSection(),
    conventionsSection(),
  ]
}

// Engines that can have validation rules (those that support migrations).
export const RULE_ENGINES = (Object.keys(ENGINE_PROFILE) as DatabaseEngine[]).filter(engineSupportsMigrations)

// --- Pre-validation checkers ------------------------------------------------
// Only rules with a checker are evaluated against migration SQL; the rest are
// advisory conventions surfaced on the rules page.

type Checker = (sql: string, value: string | undefined) => string | null

export const RULE_CHECKERS: Record<string, Checker> = {
  'drop-if-exists': (sql) =>
    /\bdrop\s+(table|index|view|materialized\s+view)\b(?!\s+if\s+exists)/i.test(sql)
      ? 'DROP statement is missing IF EXISTS.'
      : null,
  'no-drop-database': (sql) =>
    /\bdrop\s+(database|schema)\b/i.test(sql) ? 'Dropping a database/schema is not allowed in migrations.' : null,
  'no-truncate': (sql) => (/\btruncate\b/i.test(sql) ? 'TRUNCATE is not allowed.' : null),
  'guard-update-delete': (sql) => {
    // Crude: flag UPDATE/DELETE statements that have no WHERE.
    const stmts = sql.split(';')
    for (const s of stmts) {
      if (/\b(update|delete)\b/i.test(s) && !/\bwhere\b/i.test(s)) return 'UPDATE/DELETE without a WHERE clause.'
    }
    return null
  },
  'max-statements': (sql, value) => {
    const limit = Number(value || '20')
    const count = sql.split(';').map((s) => s.trim()).filter(Boolean).length
    return count > limit ? `Migration has ${count} statements (limit ${limit}).` : null
  },
  'pg-concurrent-index': (sql) =>
    /\bcreate\s+index\b/i.test(sql) && !/\bconcurrently\b/i.test(sql)
      ? 'CREATE INDEX should use CONCURRENTLY.'
      : null,
  'ch-no-optimize-final': (sql) => (/\boptimize\b[\s\S]*\bfinal\b/i.test(sql) ? 'Avoid OPTIMIZE … FINAL in migrations.' : null),
  'cql-no-allow-filtering': (sql) => (/\ballow\s+filtering\b/i.test(sql) ? 'ALLOW FILTERING is not allowed.' : null),
}

export interface Violation {
  ruleId: string
  ruleTitle: string
  message: string
}

// Rules that must be evaluated against the whole migration, not a single
// statement (e.g. counting statements). Everything else is per-statement.
const AGGREGATE_RULES = new Set(['max-statements'])

function run(sql: string, sections: ValidationSection[], include: (id: string) => boolean): Violation[] {
  const violations: Violation[] = []
  for (const section of sections) {
    if (!section.enabled) continue
    for (const rule of section.rules) {
      if (!rule.enabled || !include(rule.id)) continue
      const checker = RULE_CHECKERS[rule.id]
      if (!checker) continue
      const msg = checker(sql, rule.currentValue ?? rule.value?.default)
      if (msg) violations.push({ ruleId: rule.id, ruleTitle: rule.title, message: msg })
    }
  }
  return violations
}

// Per-statement rules — run against a single statement.
export function prevalidateStatement(sql: string, sections: ValidationSection[]): Violation[] {
  return run(sql, sections, (id) => !AGGREGATE_RULES.has(id))
}

// Migration-level rules — run once against the whole migration.
export function prevalidateMigration(sql: string, sections: ValidationSection[]): Violation[] {
  return run(sql, sections, (id) => AGGREGATE_RULES.has(id))
}
