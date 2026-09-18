import { describe, expect, test } from 'bun:test'
import { HttpError } from '../http'
import { assertClickHouseReadOnly, clickhouseDriver, mapClickHouseIntrospection } from './clickhouse'
import { getDriver } from './index'

const assertRejected = (sql: string, message?: string) => {
  try {
    assertClickHouseReadOnly(sql)
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError)
    expect((err as HttpError).status).toBe(400)
    if (message) expect((err as HttpError).message).toBe(message)
    return
  }
  throw new Error(`Expected query to be rejected: ${sql}`)
}

describe('assertClickHouseReadOnly', () => {
  test('accepts ClickHouse read statements, including leading comments', () => {
    for (const sql of [
      'SELECT 1',
      'SHOW TABLES',
      'DESCRIBE TABLE events',
      'DESC TABLE events',
      'WITH 1 AS id SELECT id',
      'EXPLAIN SELECT * FROM events',
      'EXISTS TABLE events',
      '/* dashboard query */ SELECT 1;',
    ]) {
      expect(() => assertClickHouseReadOnly(sql)).not.toThrow()
    }
  })

  test('rejects empty and write statements', () => {
    assertRejected('', 'Only read-only queries (SELECT / SHOW / DESCRIBE / WITH / EXPLAIN) are allowed.')
    assertRejected('INSERT INTO events VALUES (1)')
    assertRejected('ALTER TABLE events DELETE WHERE id = 1')
  })

  test('does not let a WITH clause prefix a mutation', () => {
    assertRejected('WITH 1 AS x INSERT INTO events SELECT x')
    assertRejected('WITH 1 AS x ALTER TABLE events DELETE WHERE id = x')
    assertRejected('WITH 1 AS x CREATE TABLE copied AS SELECT x')
    assertRejected('WITH 1 AS x SYSTEM FLUSH LOGS')
    expect(() => assertClickHouseReadOnly('WITH 1 AS x SELECT x')).not.toThrow()
  })

  test('rejects multiple statements while permitting a trailing semicolon', () => {
    expect(() => assertClickHouseReadOnly('SELECT 1;  \n')).not.toThrow()
    assertRejected('SELECT 1; SELECT 2', 'Only a single statement is allowed.')
    assertRejected('SELECT 1; /* a separator inside a comment is harmless */ DROP TABLE events')
  })

  test('does not mistake quoted literals or comments for separators and clauses', () => {
    expect(() => assertClickHouseReadOnly("SELECT ';', 'FORMAT JSON', 'INTO OUTFILE' -- ; FORMAT\n")).not.toThrow()
    expect(() => assertClickHouseReadOnly('SELECT 1 /* ; INTO OUTFILE FORMAT */')).not.toThrow()
  })

  test('rejects explicit output formatting and file output', () => {
    assertRejected('SELECT 1 FORMAT JSONEachRow', 'FORMAT clauses are not supported in the read panel.')
    assertRejected("SELECT * FROM events INTO OUTFILE '/tmp/events.tsv'", 'Writing query results to a file is not allowed.')
  })
})

describe('ClickHouse driver registry', () => {
  test('resolves ClickHouse to a live-access driver', () => {
    expect(getDriver('clickhouse')).toBe(clickhouseDriver)
  })
})

describe('mapClickHouseIntrospection', () => {
  test('maps system tables and columns into the schema contract', () => {
    const tables = mapClickHouseIntrospection(
      [
        { schema: 'analytics', name: 'events', estimated_rows: '42', sorting_key: 'occurred_at, id' },
        { schema: 'analytics', name: 'empty', estimated_rows: null, sorting_key: '' },
      ],
      [
        { schema: 'analytics', table_name: 'events', name: 'id', type: 'UInt64', is_in_primary_key: 1, default_expression: '', default_kind: '' },
        { schema: 'analytics', table_name: 'events', name: 'metadata', type: 'Nullable(String)', is_in_primary_key: 0, default_expression: "'{}'", default_kind: 'DEFAULT' },
      ],
    )

    expect(tables).toEqual([
      {
        schema: 'analytics', name: 'events', estimated_rows: 42,
        columns: [
          { name: 'id', data_type: 'UInt64', nullable: false, default: null, is_primary_key: true },
          { name: 'metadata', data_type: 'Nullable(String)', nullable: true, default: "'{}'", is_primary_key: false },
        ],
        indexes: [{ name: 'ORDER BY', columns: ['occurred_at, id'], unique: false }],
      },
      { schema: 'analytics', name: 'empty', estimated_rows: 0, columns: [], indexes: [] },
    ])
  })
})
