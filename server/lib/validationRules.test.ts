import { describe, expect, test } from 'bun:test'
import {
  mergeValidationSections,
  prevalidateMigration,
  prevalidateStatement,
  RULE_CHECKERS,
  rulesForEngine,
} from '../../src/lib/validationRules'

function violationIds(sql: string) {
  return prevalidateStatement(sql, rulesForEngine('clickhouse')).map((violation) => violation.ruleId)
}

function rulesWithEnabled(engine: 'postgres' | 'mysql' | 'clickhouse', ids: string[]) {
  return rulesForEngine(engine).map((section) => ({
    ...section,
    rules: section.rules.map((rule) => ids.includes(rule.id) ? { ...rule, enabled: true } : rule),
  }))
}

describe('ClickHouse validation rules', () => {
  test('has an enforceable, ClickHouse-specific catalog', () => {
    const sections = rulesForEngine('clickhouse')
    const ids = sections.flatMap((section) => section.rules.map((rule) => rule.id))

    expect(ids).toContain('ch-require-on-cluster')
    expect(ids).toContain('ch-mutation-scope')
    expect(ids).toContain('ch-snake-case-identifiers')
    expect(ids).not.toContain('guard-update-delete')
    expect(ids).not.toContain('not-null-default')
    for (const engine of ['postgres', 'mysql', 'clickhouse'] as const) {
      for (const rule of rulesForEngine(engine).flatMap((section) => section.rules)) {
        expect(RULE_CHECKERS[rule.id]).toBeDefined()
      }
    }
    for (const engine of ['aurora_postgres', 'alloydb', 'redshift', 'aurora_mysql', 'mariadb', 'tidb', 'starrocks', 'cassandra'] as const) {
      expect(rulesForEngine(engine)).toEqual([])
    }
  })

  test('offers ON CLUSTER enforcement only when a distributed deployment enables it', () => {
    const sections = rulesWithEnabled('clickhouse', ['ch-require-on-cluster'])
    expect(prevalidateStatement('CREATE TABLE events (id UUID) ENGINE = MergeTree ORDER BY id', sections).map((v) => v.ruleId)).toContain('ch-require-on-cluster')
    expect(prevalidateStatement('CREATE TABLE events ON CLUSTER main (id UUID) ENGINE = MergeTree ORDER BY id', sections).map((v) => v.ruleId)).not.toContain('ch-require-on-cluster')
    expect(prevalidateStatement('CREATE TABLE events ON CLUSTER `main_cluster` (id UUID) ENGINE = MergeTree ORDER BY id', sections).map((v) => v.ruleId)).not.toContain('ch-require-on-cluster')
    expect(prevalidateStatement('CREATE TABLE events ON CLUSTER "main_cluster" (id UUID) ENGINE = MergeTree ORDER BY id', sections).map((v) => v.ruleId)).not.toContain('ch-require-on-cluster')
  })

  test('blocks dangerous mutations and scopes ALTER UPDATE/DELETE', () => {
    const withoutScope = violationIds("ALTER TABLE events ON CLUSTER main UPDATE status = 'archived' WHERE status = 'closed'")
    expect(withoutScope).toContain('ch-mutation-scope')

    const scoped = violationIds("ALTER TABLE events ON CLUSTER main UPDATE status = 'archived' IN PARTITION '202409' WHERE status = 'closed'")
    expect(scoped).not.toContain('ch-mutation-scope')
    expect(violationIds('DROP DATABASE analytics ON CLUSTER main')).toContain('no-drop-database')
    expect(violationIds('TRUNCATE TABLE events ON CLUSTER main')).toContain('no-truncate')
    expect(violationIds('OPTIMIZE TABLE events ON CLUSTER main FINAL')).toContain('ch-no-optimize-final')
    expect(violationIds("ALTER TABLE events DROP PARTITION '202409'")).toContain('ch-no-drop-partition')
    expect(violationIds('ALTER TABLE events DROP COLUMN legacy_flag')).not.toContain('ch-no-drop-partition')
    expect(violationIds('ALTER TABLE events DROP DETACHED PARTITION 202409')).not.toContain('ch-no-drop-partition')
    expect(violationIds('ALTER TABLE events FORGET PARTITION 202409')).not.toContain('ch-no-drop-partition')
    expect(violationIds('ALTER TABLE "events" DELETE WHERE id = 1')).toContain('ch-mutation-scope')
  })

  test('enforces lower snake_case only for new tables and added columns', () => {
    expect(violationIds('CREATE TABLE UserEvents ON CLUSTER main (id UUID) ENGINE = MergeTree ORDER BY id')).toContain('ch-snake-case-identifiers')
    expect(violationIds('ALTER TABLE events ON CLUSTER main ADD COLUMN sessionID UUID')).toContain('ch-snake-case-identifiers')
    expect(violationIds('ALTER TABLE events ON CLUSTER main ADD COLUMN session_id UUID')).not.toContain('ch-snake-case-identifiers')
    expect(violationIds('ALTER TABLE "events" ADD COLUMN "sessionID" UUID')).toContain('ch-snake-case-identifiers')
  })

  test('uses the migration-level statement limit', () => {
    const sections = rulesForEngine('clickhouse').map((section) => ({
      ...section,
      rules: section.rules.map((rule) => rule.id === 'max-statements' ? { ...rule, currentValue: '1' } : rule),
    }))
    expect(prevalidateMigration('SELECT 1; SELECT 2;', sections).map((violation) => violation.ruleId)).toEqual(['max-statements'])
  })
})

describe('PostgreSQL and MySQL validation rules', () => {
  test('enforces snake_case and safe NOT NULL added columns', () => {
    const postgres = rulesForEngine('postgres')
    expect(prevalidateStatement('CREATE TABLE UserEvents (id uuid)', postgres).map((v) => v.ruleId)).toContain('snake-case')
    expect(prevalidateStatement('ALTER TABLE events ADD COLUMN status text NOT NULL', postgres).map((v) => v.ruleId)).toContain('not-null-default')
    expect(prevalidateStatement("ALTER TABLE events ADD COLUMN status text NOT NULL DEFAULT 'active'", postgres).map((v) => v.ruleId)).not.toContain('not-null-default')
  })

  test('checks every explicit ADD COLUMN clause in a multi-column ALTER', () => {
    const postgres = rulesForEngine('postgres')
    const violations = prevalidateStatement("ALTER TABLE events ADD COLUMN first_name text NOT NULL DEFAULT 'unknown', ADD COLUMN DisplayName text NOT NULL", postgres)
    expect(violations.map((v) => v.ruleId)).toContain('snake-case')
    expect(violations.map((v) => v.ruleId)).toContain('not-null-default')
  })

  test('blocks PostgreSQL DROP and ALTER DROP CASCADE', () => {
    const postgres = rulesForEngine('postgres')
    expect(prevalidateStatement('DROP TABLE IF EXISTS legacy_events CASCADE', postgres).map((v) => v.ruleId)).toContain('pg-no-drop-cascade')
    expect(prevalidateStatement('ALTER TABLE events DROP COLUMN legacy_flag CASCADE', postgres).map((v) => v.ruleId)).toContain('pg-no-drop-cascade')
    expect(prevalidateStatement("SELECT 'DROP TABLE events CASCADE'", postgres).map((v) => v.ruleId)).not.toContain('pg-no-drop-cascade')
  })

  test('keeps MySQL online DDL and utf8mb4 requirements opt-in', () => {
    const defaults = rulesForEngine('mysql')
    expect(prevalidateStatement('ALTER TABLE orders ADD COLUMN note text', defaults).map((v) => v.ruleId)).not.toContain('mysql-require-online-ddl')
    const mysql = rulesWithEnabled('mysql', ['mysql-require-online-ddl', 'mysql-require-utf8mb4'])
    expect(prevalidateStatement('ALTER TABLE orders ADD COLUMN note text', mysql).map((v) => v.ruleId)).toContain('mysql-require-online-ddl')
    expect(prevalidateStatement('ALTER TABLE orders ADD COLUMN note text, ALGORITHM=INPLACE, LOCK=NONE', mysql).map((v) => v.ruleId)).not.toContain('mysql-require-online-ddl')
    expect(prevalidateStatement('CREATE TABLE notes (body text)', mysql).map((v) => v.ruleId)).toContain('mysql-require-utf8mb4')
    expect(prevalidateStatement('CREATE TABLE notes (body text) DEFAULT CHARSET=utf8mb4', mysql).map((v) => v.ruleId)).not.toContain('mysql-require-utf8mb4')
  })

  test('does not treat literals or comments as destructive keywords', () => {
    const postgres = rulesForEngine('postgres')
    expect(prevalidateStatement("SELECT 'DROP TABLE users'", postgres).map((v) => v.ruleId)).not.toContain('drop-if-exists')
    expect(prevalidateStatement('-- TRUNCATE TABLE users\nSELECT 1', postgres).map((v) => v.ruleId)).not.toContain('no-truncate')
    expect(violationIds("SELECT 'OPTIMIZE TABLE events FINAL'")).not.toContain('ch-no-optimize-final')
  })

  test('uses only engine-supported DROP IF EXISTS syntax', () => {
    const mysql = rulesForEngine('mysql')
    expect(prevalidateStatement('DROP TABLE old_orders', mysql).map((v) => v.ruleId)).toContain('mysql-drop-if-exists')
    expect(prevalidateStatement('DROP INDEX orders_customer_idx ON orders', mysql).map((v) => v.ruleId)).not.toContain('mysql-drop-if-exists')
    const postgres = rulesForEngine('postgres')
    expect(prevalidateStatement('DROP INDEX users_email_idx', postgres).map((v) => v.ruleId)).toContain('pg-drop-if-exists')
    const clickhouse = rulesForEngine('clickhouse')
    expect(prevalidateStatement('DROP DICTIONARY country_codes', clickhouse).map((v) => v.ruleId)).toContain('ch-drop-if-exists')
  })
})

describe('mergeValidationSections', () => {
  test('preserves saved settings while adding current rules and dropping retired ones', () => {
    const defaults = rulesForEngine('clickhouse')
    const merged = mergeValidationSections(defaults, [
      {
        id: 'safety',
        enabled: false,
        rules: [
          { id: 'drop-if-exists', enabled: false },
          { id: 'retired-rule', enabled: true },
        ],
      },
      {
        id: 'limits',
        rules: [{ id: 'max-statements', enabled: true, currentValue: '7' }],
      },
      { id: 'retired-section', enabled: true, rules: [] },
    ])

    const safety = merged.find((section) => section.id === 'safety')!
    const limits = merged.find((section) => section.id === 'limits')!
    expect(safety.enabled).toBe(false)
    expect(safety.rules.find((rule) => rule.id === 'ch-drop-if-exists')?.enabled).toBe(false)
    expect(safety.rules.some((rule) => rule.id === 'ch-mutation-scope')).toBe(true)
    expect(limits.rules.find((rule) => rule.id === 'max-statements')?.currentValue).toBe('7')
    expect(merged.some((section) => section.id === 'retired-section')).toBe(false)
  })

  test('retires old advisory IDs instead of turning saved settings into new blocks', () => {
    const mysql = mergeValidationSections(rulesForEngine('mysql'), [
      { id: 'performance', rules: [{ id: 'mysql-online-ddl', enabled: true }, { id: 'mysql-utf8mb4', enabled: true }] },
    ])
    const performance = mysql.find((section) => section.id === 'performance')!
    expect(performance.rules.find((rule) => rule.id === 'mysql-require-online-ddl')?.enabled).toBe(false)
    expect(performance.rules.find((rule) => rule.id === 'mysql-require-utf8mb4')?.enabled).toBe(false)
  })

  test('counts statement separators outside literals/comments and uses a safe limit fallback', () => {
    const sections = rulesForEngine('clickhouse').map((section) => ({
      ...section,
      rules: section.rules.map((rule) => rule.id === 'max-statements' ? { ...rule, currentValue: '1' } : rule),
    }))
    expect(prevalidateMigration("SELECT ';' -- ;\n", sections)).toEqual([])
    expect(prevalidateMigration('SELECT 1; SELECT 2;', sections).map((v) => v.ruleId)).toEqual(['max-statements'])
    expect(prevalidateMigration('SELECT 1 -- statement comment\n;\nSELECT 2', sections).map((v) => v.ruleId)).toEqual(['max-statements'])
    const invalidLimit = sections.map((section) => ({
      ...section,
      rules: section.rules.map((rule) => rule.id === 'max-statements' ? { ...rule, currentValue: 'not-a-number' } : rule),
    }))
    expect(prevalidateMigration(Array.from({ length: 21 }, () => 'SELECT 1').join(';'), invalidLimit).map((v) => v.message)).toEqual(['Migration has 21 statements (limit 20).'])
    const fractionalLimit = invalidLimit.map((section) => ({
      ...section,
      rules: section.rules.map((rule) => rule.id === 'max-statements' ? { ...rule, currentValue: '0.5' } : rule),
    }))
    expect(prevalidateMigration(Array.from({ length: 21 }, () => 'SELECT 1').join(';'), fractionalLimit).map((v) => v.message)).toEqual(['Migration has 21 statements (limit 20).'])
  })
})
