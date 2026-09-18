import type { DatabaseEngine } from '../types'
import { engineSupportsMigrations } from './engines'
import { stripLiteralsAndComments } from './sqlSyntax'

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

type SavedRule = { id?: unknown; enabled?: unknown; currentValue?: unknown }
type SavedSection = { id?: unknown; enabled?: unknown; rules?: unknown }

// The original broad DROP rule had one toggle. Its replacements are profile
// specific, but an organization that deliberately disabled it should retain
// that choice when its saved configuration is reconciled.
const LEGACY_RULE_ID: Partial<Record<string, string>> = {
  'pg-drop-if-exists': 'drop-if-exists',
  'mysql-drop-if-exists': 'drop-if-exists',
  'ch-drop-if-exists': 'drop-if-exists',
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function cloneSections(sections: ValidationSection[]): ValidationSection[] {
  return sections.map((section) => ({
    ...section,
    rules: section.rules.map((rule) => ({ ...rule, value: rule.value ? { ...rule.value } : undefined })),
  }))
}

// Stored rule sets are user configuration, not a second catalog. Reconcile them
// with the current defaults so new rules appear automatically and retired rules
// disappear, while preserving the only user-editable fields (toggles and values).
export function mergeValidationSections(defaults: ValidationSection[], saved: unknown): ValidationSection[] {
  if (!Array.isArray(saved)) return cloneSections(defaults)
  const savedById = new Map<string, SavedSection>()
  for (const value of saved) {
    const section = asRecord(value) as SavedSection | null
    if (typeof section?.id === 'string') savedById.set(section.id, section)
  }
  return defaults.map((section) => {
    const prior = savedById.get(section.id)
    const savedRules = new Map<string, SavedRule>()
    if (Array.isArray(prior?.rules)) {
      for (const value of prior.rules) {
        const rule = asRecord(value) as SavedRule | null
        if (typeof rule?.id === 'string') savedRules.set(rule.id, rule)
      }
    }
    return {
      ...section,
      enabled: typeof prior?.enabled === 'boolean' ? prior.enabled : section.enabled,
      rules: section.rules.map((rule) => {
        const savedRule = savedRules.get(rule.id) ?? savedRules.get(LEGACY_RULE_ID[rule.id] ?? '')
        return {
          ...rule,
          value: rule.value ? { ...rule.value } : undefined,
          enabled: typeof savedRule?.enabled === 'boolean' ? savedRule.enabled : rule.enabled,
          currentValue: typeof savedRule?.currentValue === 'string' ? savedRule.currentValue : rule.currentValue,
        }
      }),
    }
  })
}

type Profile = 'postgres' | 'mysql' | 'clickhouse'

const ENGINE_PROFILE: Record<string, Profile> = {
  postgres: 'postgres',
  mysql: 'mysql',
  clickhouse: 'clickhouse',
}

// --- Shared sections --------------------------------------------------------

function safetySection(): ValidationSection {
  return {
    id: 'safety',
    title: 'Safety',
    enabled: true,
    rules: [
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

function dropRule(id: string, description: string, example: string): ValidationRule {
  return { id, title: 'Guard supported DROP with IF EXISTS', description, example, enabled: true }
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
        title: 'snake_case table and added-column names',
        description: 'New table names and columns introduced with ALTER TABLE ADD COLUMN must use lower snake_case.',
        example: 'CREATE TABLE user_sessions (...);',
        enabled: true,
      },
      {
        id: 'not-null-default',
        title: 'NOT NULL columns need a default',
        description: 'ALTER TABLE ADD COLUMN with NOT NULL must include a DEFAULT for populated tables.',
        example: "ADD COLUMN status text NOT NULL DEFAULT 'active';",
        enabled: true,
      },
    ],
  }
}

// ClickHouse's mutations are ALTER TABLE commands, and its defaults differ from
// row-store databases: a non-Nullable column can be backfilled from its type's
// default value. Keep this catalog separate so we do not present misleading
// UPDATE/DELETE or NOT NULL guidance as enforced ClickHouse rules.
function clickHouseSafetySection(): ValidationSection {
  const section = safetySection()
  section.rules = section.rules
    .filter((rule) => rule.id !== 'guard-update-delete')
    .map((rule) => rule.id === 'no-truncate' ? { ...rule, enabled: true, description: 'TRUNCATE removes every part from a table immediately.' } : rule)
  section.rules.unshift(dropRule(
    'ch-drop-if-exists',
    'DROP TABLE, VIEW and DICTIONARY statements must use IF EXISTS so re-running a migration is idempotent.',
    'DROP TABLE IF EXISTS legacy_events;',
  ))
  section.rules.push(
    {
      id: 'ch-mutation-scope',
      title: 'Scope ALTER UPDATE and DELETE mutations',
      description: 'ALTER TABLE UPDATE and DELETE must include both a WHERE predicate and IN PARTITION to limit rewritten data.',
      example: "ALTER TABLE events UPDATE status = 'archived' IN PARTITION '202409' WHERE status = 'closed';",
      enabled: true,
    },
    {
      id: 'ch-no-drop-partition',
      title: 'Disallow DROP PARTITION',
      description: 'ALTER TABLE DROP PARTITION removes an entire data partition and is not allowed in migrations.',
      enabled: true,
    },
  )
  return {
    ...section,
    rules: section.rules,
  }
}

function postgresSafetySection(): ValidationSection {
  const section = safetySection()
  section.rules.unshift(dropRule(
    'pg-drop-if-exists',
    'DROP TABLE, INDEX, VIEW and MATERIALIZED VIEW statements must use IF EXISTS so re-running a migration is idempotent.',
    'DROP TABLE IF EXISTS legacy_events;',
  ))
  section.rules.push({
    id: 'pg-no-drop-cascade',
    title: 'Disallow DROP … CASCADE',
    description: 'DROP and ALTER … DROP with CASCADE can remove dependent objects beyond the reviewed target.',
    example: 'DROP TABLE IF EXISTS legacy_events;',
    enabled: true,
  })
  return section
}

function mysqlSafetySection(): ValidationSection {
  const section = safetySection()
  section.rules.unshift(dropRule(
    'mysql-drop-if-exists',
    'Top-level DROP TABLE and DROP VIEW statements must use IF EXISTS so re-running a migration is idempotent. MySQL DROP INDEX does not support IF EXISTS.',
    'DROP TABLE IF EXISTS legacy_orders;',
  ))
  return section
}

function clickHouseLimitsSection(): ValidationSection {
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
    ],
  }
}

function clickHouseConventionsSection(): ValidationSection {
  return {
    id: 'conventions',
    title: 'Conventions',
    enabled: true,
    rules: [
      {
        id: 'ch-snake-case-identifiers',
        title: 'snake_case table and added-column names',
        description: 'New table names and columns introduced with ALTER TABLE ADD COLUMN must use lower snake_case.',
        example: 'ALTER TABLE events ADD COLUMN session_id UUID;',
        enabled: true,
      },
    ],
  }
}

// --- Per-profile performance/locking section --------------------------------

const PERFORMANCE: Record<Profile, ValidationRule[]> = {
  postgres: [
  ],
  mysql: [
    {
      id: 'mysql-require-online-ddl',
      title: 'Use online DDL',
      description: 'Where supported, require ALTER TABLE to specify ALGORITHM=INPLACE or INSTANT and LOCK=NONE.',
      example: 'ALTER TABLE orders ADD COLUMN note text, ALGORITHM=INPLACE, LOCK=NONE;',
      enabled: false,
    },
    {
      id: 'mysql-require-utf8mb4',
      title: 'Use utf8mb4 charset',
      description: 'Where supported, require CREATE TABLE statements with character or text columns to declare utf8mb4.',
      enabled: false,
    },
  ],
  clickhouse: [
    {
      id: 'ch-require-on-cluster',
      title: 'Require ON CLUSTER for distributed DDL',
      description: 'For self-managed distributed deployments, require CREATE, ALTER, DROP, TRUNCATE, RENAME, ATTACH, DETACH and OPTIMIZE statements to target a cluster. Leave disabled for standalone or ClickHouse Cloud databases.',
      example: 'ALTER TABLE events ON CLUSTER main ADD COLUMN session_id UUID;',
      enabled: false,
    },
    {
      id: 'ch-no-optimize-final',
      title: 'Disallow OPTIMIZE … FINAL',
      description: 'OPTIMIZE FINAL is not allowed because it merges all parts and can consume substantial I/O and disk space.',
      enabled: true,
    },
  ],
}

export function rulesForEngine(engine: DatabaseEngine): ValidationSection[] {
  const profile = ENGINE_PROFILE[engine]
  if (!profile) return []
  if (profile === 'clickhouse') {
    return [
      clickHouseSafetySection(),
      { id: 'performance', title: 'Performance & locking', enabled: true, rules: PERFORMANCE.clickhouse.map((r) => ({ ...r })) },
      clickHouseLimitsSection(),
      clickHouseConventionsSection(),
    ]
  }
  const safety = profile === 'postgres' ? postgresSafetySection() : mysqlSafetySection()
  return [
    safety,
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

function clickHouseMutation(sql: string): 'update' | 'delete' | null {
  const code = stripLiteralsAndComments(sql, { keepIdentifiers: true, keepDoubleQuotedIdentifiers: true })
  const match = code.match(/^\s*alter\s+table\s+(?:if\s+exists\s+)?(?:[\w`."-]+)(?:\s+on\s+cluster\s+(?:[\w`."-]+))?\s+(update|delete)\b/i)
  const operation = match?.[1]?.toLowerCase()
  return operation === 'update' || operation === 'delete' ? operation : null
}

function lastIdentifierPart(raw: string): string {
  const part = raw.split('.').at(-1) ?? raw
  return part.replace(/^[`"]|[`"]$/g, '')
}

function identifierIsSnakeCase(raw: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(lastIdentifierPart(raw))
}

function addedColumnNames(sql: string): string[] {
  const code = stripLiteralsAndComments(sql, { keepIdentifiers: true, keepDoubleQuotedIdentifiers: true })
  if (!/^\s*alter\s+table\b/i.test(code)) return []
  const names: string[] = []
  const matcher = /\badd\s+column\s+(?:if\s+not\s+exists\s+)?([\w`".-]+)/gi
  for (const match of code.matchAll(matcher)) names.push(match[1])
  return names
}

function addedColumnDefinitions(sql: string): string[] {
  const code = stripLiteralsAndComments(sql, { keepDoubleQuotedIdentifiers: true })
  if (!/^\s*alter\s+table\b/i.test(code)) return []
  const definitions: string[] = []
  const matcher = /\badd\s+column\s+(?:if\s+not\s+exists\s+)?[\w`".-]+\s+([\s\S]*?)(?=,\s*add\s+column\b|$)/gi
  for (const match of code.matchAll(matcher)) definitions.push(match[1])
  return definitions
}

export const RULE_CHECKERS: Record<string, Checker> = {
  'pg-drop-if-exists': (sql) => {
    const code = stripLiteralsAndComments(sql)
    return /^\s*drop\s+(table|index|view|materialized\s+view)\b(?!\s+if\s+exists)/i.test(code)
      ? 'DROP statement is missing IF EXISTS.'
      : null
  },
  'mysql-drop-if-exists': (sql) => {
    const code = stripLiteralsAndComments(sql)
    return /^\s*drop\s+(table|view)\b(?!\s+if\s+exists)/i.test(code)
      ? 'DROP statement is missing IF EXISTS.'
      : null
  },
  'ch-drop-if-exists': (sql) => {
    const code = stripLiteralsAndComments(sql)
    return /^\s*drop\s+(table|view|dictionary)\b(?!\s+if\s+exists)/i.test(code)
      ? 'DROP statement is missing IF EXISTS.'
      : null
  },
  'no-drop-database': (sql) =>
    /\bdrop\s+(database|schema)\b/i.test(stripLiteralsAndComments(sql)) ? 'Dropping a database/schema is not allowed in migrations.' : null,
  'no-truncate': (sql) => (/\btruncate\b/i.test(stripLiteralsAndComments(sql)) ? 'TRUNCATE is not allowed.' : null),
  'guard-update-delete': (sql) => {
    // Crude: flag UPDATE/DELETE statements that have no WHERE.
    const stmts = stripLiteralsAndComments(sql).split(';')
    for (const s of stmts) {
      if (/\b(update|delete)\b/i.test(s) && !/\bwhere\b/i.test(s)) return 'UPDATE/DELETE without a WHERE clause.'
    }
    return null
  },
  'max-statements': (sql, value) => {
    const configured = Number(value)
    const limit = Number.isFinite(configured) && Number.isInteger(configured) && configured >= 1 ? configured : 20
    const count = stripLiteralsAndComments(sql).split(';').map((s) => s.trim()).filter(Boolean).length
    return count > limit ? `Migration has ${count} statements (limit ${limit}).` : null
  },
  'pg-no-drop-cascade': (sql) => {
    const code = stripLiteralsAndComments(sql)
    if (!/\bcascade\b/i.test(code)) return null
    return /^\s*drop\b/i.test(code) || /^\s*alter\b[\s\S]*\bdrop\b/i.test(code)
      ? 'DROP … CASCADE is not allowed in migrations.'
      : null
  },
  'mysql-require-online-ddl': (sql) => {
    const code = stripLiteralsAndComments(sql)
    if (!/^\s*alter\s+table\b/i.test(code)) return null
    return /\balgorithm\s*=\s*(inplace|instant)\b/i.test(code) && /\block\s*=\s*none\b/i.test(code)
      ? null
      : 'MySQL ALTER TABLE must specify ALGORITHM=INPLACE or INSTANT and LOCK=NONE.'
  },
  'mysql-require-utf8mb4': (sql) => {
    const code = stripLiteralsAndComments(sql)
    if (!/^\s*create\s+table\b/i.test(code) || !/\b(char|varchar|tinytext|text|mediumtext|longtext)\b/i.test(code)) return null
    return /\b(?:default\s+)?(?:character\s+set|charset)\s*(?:=\s*)?utf8mb4\b/i.test(code)
      ? null
      : 'MySQL CREATE TABLE statements with text columns must declare utf8mb4.'
  },
  'snake-case': (sql) => {
    const code = stripLiteralsAndComments(sql, { keepIdentifiers: true, keepDoubleQuotedIdentifiers: true })
    const create = code.match(/^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?([\w`".-]+)/i)
    const identifiers = create?.[1] ? [create[1]] : addedColumnNames(sql)
    if (identifiers.length === 0 || identifiers.every(identifierIsSnakeCase)) return null
    return 'Table and added-column names must use lower snake_case.'
  },
  'not-null-default': (sql) => {
    const definitions = addedColumnDefinitions(sql)
    return definitions.some((definition) => /\bnot\s+null\b/i.test(definition) && !/\bdefault\b/i.test(definition))
      ? 'ALTER TABLE ADD COLUMN with NOT NULL must include a DEFAULT.'
      : null
  },
  'ch-require-on-cluster': (sql) => {
    const code = stripLiteralsAndComments(sql, { keepIdentifiers: true, keepDoubleQuotedIdentifiers: true })
    if (!/^\s*(create|alter|drop|truncate|rename|attach|detach|undrop|optimize)\b/i.test(code)) return null
    return /\bon\s+cluster\s+(?:`[^`]+`|"[^"]+"|[a-z_][a-z0-9_]*)(?=\s|$)/i.test(code)
      ? null
      : 'ClickHouse DDL must include ON CLUSTER <cluster_name>.'
  },
  'ch-no-optimize-final': (sql) => (/\boptimize\b[\s\S]*\bfinal\b/i.test(stripLiteralsAndComments(sql)) ? 'OPTIMIZE … FINAL is not allowed in migrations.' : null),
  'ch-mutation-scope': (sql) => {
    if (!clickHouseMutation(sql)) return null
    const code = stripLiteralsAndComments(sql)
    if (!/\bin\s+partition\b/i.test(code)) return 'ClickHouse ALTER UPDATE/DELETE must target IN PARTITION.'
    if (!/\bwhere\b/i.test(code)) return 'ClickHouse ALTER UPDATE/DELETE must include a WHERE predicate.'
    return null
  },
  'ch-snake-case-identifiers': (sql) => {
    const code = stripLiteralsAndComments(sql, { keepIdentifiers: true, keepDoubleQuotedIdentifiers: true })
    const create = code.match(/^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?([\w`".-]+)/i)
    const identifiers = create?.[1] ? [create[1]] : addedColumnNames(sql)
    if (identifiers.length === 0 || identifiers.every(identifierIsSnakeCase)) return null
    return 'ClickHouse table and added-column names must use lower snake_case.'
  },
  'ch-no-drop-partition': (sql) =>
    /^\s*alter\s+table\b[\s\S]*\bdrop\s+partition\b/i.test(stripLiteralsAndComments(sql, { keepIdentifiers: true, keepDoubleQuotedIdentifiers: true }))
      ? 'ClickHouse ALTER TABLE DROP PARTITION is not allowed in migrations.'
      : null,
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
