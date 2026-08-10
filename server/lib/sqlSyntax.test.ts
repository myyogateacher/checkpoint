import { describe, expect, test } from 'bun:test'
import { MULTI_STATEMENT_ERROR, checkSyntax } from './sqlSyntax'

// Engines with no parser dialect (ClickHouse, Cassandra, …) take the
// parser-independent fallback path only.
const NO_PARSER = 'clickhouse'

describe('checkSyntax — multi-statement blocks', () => {
  test('two statements in one block are rejected', () => {
    expect(checkSyntax('SELECT 1; SELECT 2', 'mysql')).toBe(MULTI_STATEMENT_ERROR)
    expect(checkSyntax('SELECT 1;\nSELECT 2;', 'postgres')).toBe(MULTI_STATEMENT_ERROR)
  })

  test('DDL pairs — the case that used to pass validation and fail on apply', () => {
    const sql = 'ALTER TABLE users ADD COLUMN a INT;\nALTER TABLE users ADD COLUMN b INT;'
    expect(checkSyntax(sql, 'mysql')).toBe(MULTI_STATEMENT_ERROR)
  })

  test('a single statement with a trailing semicolon is accepted', () => {
    expect(checkSyntax('SELECT 1;', 'mysql')).toBeNull()
    expect(checkSyntax('SELECT 1;\n\n  ', 'mysql')).toBeNull()
    expect(checkSyntax('SELECT 1', 'mysql')).toBeNull()
  })

  test('semicolons inside string literals are not separators', () => {
    expect(checkSyntax("SELECT 'a;b' AS x", 'mysql')).toBeNull()
    expect(checkSyntax("SELECT 'a;b' AS x;", 'postgres')).toBeNull()
    // Escaped and doubled quotes must not end the literal early.
    expect(checkSyntax("SELECT 'it''s; fine' AS x", 'mysql')).toBeNull()
    expect(checkSyntax("SELECT 'back\\'; slash' AS x", 'mysql')).toBeNull()
    expect(checkSyntax('SELECT "a;b" AS x', 'mysql')).toBeNull()
    expect(checkSyntax('SELECT 1 AS `a;b`', 'mysql')).toBeNull()
  })

  test('semicolons inside comments are not separators', () => {
    expect(checkSyntax('SELECT 1 -- and; then more\n', 'mysql')).toBeNull()
    expect(checkSyntax('SELECT 1 # and; then more\n', 'mysql')).toBeNull()
    expect(checkSyntax('SELECT 1 /* and; then\n more */', 'mysql')).toBeNull()
    expect(checkSyntax('/* lead; in */ SELECT 1;', 'mysql')).toBeNull()
  })

  test("a `--` inside a string doesn't hide a later separator", () => {
    expect(checkSyntax("SELECT 'a--'; SELECT 2", 'mysql')).toBe(MULTI_STATEMENT_ERROR)
  })

  test('rejected via the fallback for engines with no parser dialect', () => {
    expect(checkSyntax('SELECT 1; SELECT 2', NO_PARSER)).toBe(MULTI_STATEMENT_ERROR)
    expect(checkSyntax('SELECT 1; SELECT 2', 'totally_unknown_engine')).toBe(MULTI_STATEMENT_ERROR)
    // …while single statements stay unchecked for those engines.
    expect(checkSyntax('SELECT 1;', NO_PARSER)).toBeNull()
    expect(checkSyntax('this is not valid sql at all', NO_PARSER)).toBeNull()
  })
})

describe('checkSyntax — single-statement behavior unchanged', () => {
  test('valid statements pass', () => {
    expect(checkSyntax('CREATE TABLE t (id INT)', 'mysql')).toBeNull()
    expect(checkSyntax('UPDATE users SET name = \'x\' WHERE id = 1', 'postgres')).toBeNull()
  })

  test('a real syntax error still reports as a syntax error', () => {
    const err = checkSyntax('SELECT FROM WHERE', 'mysql')
    expect(err).not.toBeNull()
    expect(err).toStartWith('Syntax error')
    expect(err).not.toBe(MULTI_STATEMENT_ERROR)
  })

  test('error messages are truncated', () => {
    const err = checkSyntax('SELCT oops', 'mysql')
    expect(err).not.toBeNull()
    expect(err!.length).toBeLessThanOrEqual(200)
  })
})
