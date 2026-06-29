import type { DatabaseEngine } from '../types'

export type EngineCategory = 'relational' | 'analytics' | 'nosql'

export const CATEGORY_LABELS: Record<EngineCategory, string> = {
  relational: 'Relational',
  analytics: 'Analytics & warehouse',
  nosql: 'NoSQL',
}

interface EngineMeta {
  label: string
  category: EngineCategory
  defaultPort: number
  // sql-formatter dialect, or null when the engine isn't SQL-formattable.
  dialect: string | null
  // Capability gates — "where feasible".
  query: boolean // read panel / Query Studio
  migrations: boolean // reviewed DDL migrations
  color: ColorKey
}

type ColorKey = 'sky' | 'amber' | 'yellow' | 'rose' | 'blue' | 'violet' | 'emerald' | 'teal'

const COLORS: Record<ColorKey, { badge: string; dot: string }> = {
  sky: { badge: 'border-sky-200/70 bg-sky-50/80 text-sky-700 dark:border-sky-400/40 dark:bg-sky-500/25 dark:text-sky-200', dot: 'bg-sky-500' },
  amber: { badge: 'border-amber-200/70 bg-amber-50/80 text-amber-700 dark:border-amber-400/40 dark:bg-amber-500/25 dark:text-amber-200', dot: 'bg-amber-500' },
  yellow: { badge: 'border-yellow-300/70 bg-yellow-50/80 text-yellow-700 dark:border-yellow-400/40 dark:bg-yellow-500/25 dark:text-yellow-200', dot: 'bg-yellow-500' },
  rose: { badge: 'border-rose-200/70 bg-rose-50/80 text-rose-700 dark:border-rose-400/40 dark:bg-rose-500/25 dark:text-rose-200', dot: 'bg-rose-500' },
  blue: { badge: 'border-blue-200/70 bg-blue-50/80 text-blue-700 dark:border-blue-400/40 dark:bg-blue-500/25 dark:text-blue-200', dot: 'bg-blue-600' },
  violet: { badge: 'border-violet-200/70 bg-violet-50/80 text-violet-700 dark:border-violet-400/40 dark:bg-violet-500/25 dark:text-violet-200', dot: 'bg-violet-500' },
  emerald: { badge: 'border-emerald-200/70 bg-emerald-50/80 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/25 dark:text-emerald-200', dot: 'bg-emerald-500' },
  teal: { badge: 'border-teal-200/70 bg-teal-50/80 text-teal-700 dark:border-teal-400/40 dark:bg-teal-500/25 dark:text-teal-200', dot: 'bg-teal-500' },
}

// The engine registry — single source of truth for labels, dialects, ports,
// capabilities, and styling.
export const ENGINES: Record<DatabaseEngine, EngineMeta> = {
  // --- Relational: PostgreSQL family ---
  postgres: { label: 'PostgreSQL', category: 'relational', defaultPort: 5432, dialect: 'postgresql', query: true, migrations: true, color: 'sky' },
  aurora_postgres: { label: 'Aurora PostgreSQL', category: 'relational', defaultPort: 5432, dialect: 'postgresql', query: true, migrations: true, color: 'sky' },
  alloydb: { label: 'AlloyDB', category: 'relational', defaultPort: 5432, dialect: 'postgresql', query: true, migrations: true, color: 'sky' },
  // --- Relational: MySQL family ---
  mysql: { label: 'MySQL', category: 'relational', defaultPort: 3306, dialect: 'mysql', query: true, migrations: true, color: 'amber' },
  aurora_mysql: { label: 'Aurora MySQL', category: 'relational', defaultPort: 3306, dialect: 'mysql', query: true, migrations: true, color: 'amber' },
  mariadb: { label: 'MariaDB', category: 'relational', defaultPort: 3306, dialect: 'mariadb', query: true, migrations: true, color: 'amber' },
  tidb: { label: 'TiDB', category: 'relational', defaultPort: 4000, dialect: 'tidb', query: true, migrations: true, color: 'amber' },
  // --- Relational: other ---
  oracle: { label: 'Oracle', category: 'relational', defaultPort: 1521, dialect: 'plsql', query: true, migrations: true, color: 'rose' },
  sqlserver: { label: 'SQL Server', category: 'relational', defaultPort: 1433, dialect: 'transactsql', query: true, migrations: true, color: 'blue' },
  // --- Analytics & warehouse ---
  clickhouse: { label: 'ClickHouse', category: 'analytics', defaultPort: 8123, dialect: 'sql', query: true, migrations: true, color: 'yellow' },
  snowflake: { label: 'Snowflake', category: 'analytics', defaultPort: 443, dialect: 'snowflake', query: true, migrations: true, color: 'sky' },
  bigquery: { label: 'BigQuery', category: 'analytics', defaultPort: 443, dialect: 'bigquery', query: true, migrations: true, color: 'blue' },
  redshift: { label: 'Redshift', category: 'analytics', defaultPort: 5439, dialect: 'redshift', query: true, migrations: true, color: 'sky' },
  hive: { label: 'Hive', category: 'analytics', defaultPort: 10000, dialect: 'hive', query: true, migrations: true, color: 'violet' },
  databricks: { label: 'Databricks', category: 'analytics', defaultPort: 443, dialect: 'spark', query: true, migrations: true, color: 'rose' },
  starrocks: { label: 'StarRocks', category: 'analytics', defaultPort: 9030, dialect: 'mysql', query: true, migrations: true, color: 'amber' },
  elasticsearch: { label: 'Elasticsearch', category: 'analytics', defaultPort: 9200, dialect: null, query: true, migrations: false, color: 'teal' },
  // --- NoSQL ---
  mongodb: { label: 'MongoDB', category: 'nosql', defaultPort: 27017, dialect: null, query: false, migrations: false, color: 'emerald' },
  redis: { label: 'Redis', category: 'nosql', defaultPort: 6379, dialect: null, query: true, migrations: false, color: 'rose' },
  cassandra: { label: 'Cassandra', category: 'nosql', defaultPort: 9042, dialect: 'sql', query: true, migrations: true, color: 'teal' },
  documentdb: { label: 'DocumentDB', category: 'nosql', defaultPort: 27017, dialect: null, query: false, migrations: false, color: 'emerald' },
  dynamodb: { label: 'DynamoDB', category: 'nosql', defaultPort: 443, dialect: null, query: true, migrations: false, color: 'blue' },
  cosmosdb: { label: 'Cosmos DB', category: 'nosql', defaultPort: 443, dialect: null, query: true, migrations: false, color: 'blue' },
}

export const ENGINE_KEYS = Object.keys(ENGINES) as DatabaseEngine[]

// Backward-compatible maps used across the app.
export const ENGINE_LABELS = Object.fromEntries(
  ENGINE_KEYS.map((e) => [e, ENGINES[e].label]),
) as Record<DatabaseEngine, string>

export const ENGINE_STYLES = Object.fromEntries(
  ENGINE_KEYS.map((e) => [e, COLORS[ENGINES[e].color].badge]),
) as Record<DatabaseEngine, string>

export function engineDot(engine: DatabaseEngine): string {
  return COLORS[ENGINES[engine].color].dot
}
export function engineDialect(engine: DatabaseEngine): string | null {
  return ENGINES[engine].dialect
}
export function engineDefaultPort(engine: DatabaseEngine): number {
  return ENGINES[engine].defaultPort
}
export function engineSupportsQuery(engine: DatabaseEngine): boolean {
  return ENGINES[engine].query
}
export function engineSupportsMigrations(engine: DatabaseEngine): boolean {
  return ENGINES[engine].migrations
}

// Dropdown options, ordered by category, with the category as the hint sub-line.
export const ENGINE_OPTIONS = ENGINE_KEYS.map((e) => ({
  value: e,
  label: ENGINES[e].label,
  hint: CATEGORY_LABELS[ENGINES[e].category],
}))
