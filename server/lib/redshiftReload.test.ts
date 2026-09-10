import { describe, expect, test } from 'bun:test'
// Shared catalog lives with the client so the submit-time notice and the apply-time
// reload can never disagree (same pattern as validationRules).
import { redshiftReloadNotice, redshiftReloadTables } from '../../src/lib/redshiftReload'
import { stripLiteralsAndComments } from '../../src/lib/sqlSyntax'

const notice = (sql: string) => redshiftReloadNotice(sql, 'mysql')

describe('statements that need a Redshift reload', () => {
  test('MODIFY COLUMN', () => {
    expect(notice('ALTER TABLE users MODIFY COLUMN age BIGINT')?.table).toBe('users')
  })

  test('CHANGE COLUMN', () => {
    expect(notice('ALTER TABLE `users` CHANGE COLUMN age years INT')?.table).toBe('users')
  })

  test('NOT NULL change, which MySQL expresses as a MODIFY', () => {
    expect(notice('ALTER TABLE users MODIFY email VARCHAR(255) NOT NULL')).not.toBeNull()
  })

  test('SET DEFAULT and DROP DEFAULT', () => {
    expect(notice("ALTER TABLE users ALTER COLUMN status SET DEFAULT 'new'")).not.toBeNull()
    expect(notice('ALTER TABLE users ALTER COLUMN status DROP DEFAULT')).not.toBeNull()
  })

  test('charset conversion', () => {
    expect(notice('ALTER TABLE users CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')).not.toBeNull()
  })

  test('ENUM change gets the varchar advice', () => {
    const n = notice("ALTER TABLE bookings MODIFY status ENUM('a','b','c')")
    expect(n?.table).toBe('bookings')
    expect(n?.reason).toContain('varchar')
  })

  test('schema qualifier and backticks are stripped', () => {
    expect(notice('ALTER TABLE `myyogateacher`.`users` MODIFY age INT')?.table).toBe('users')
  })
})

describe('statements that do not', () => {
  test('plain ADD COLUMN', () => {
    expect(notice('ALTER TABLE users ADD COLUMN nickname VARCHAR(50)')).toBeNull()
  })

  test('a new column carrying its own charset is not a table charset change', () => {
    expect(notice('ALTER TABLE users ADD COLUMN bio TEXT CHARACTER SET utf8mb4')).toBeNull()
  })

  test('ADD COLUMN of an ENUM type is an add, not a definition change', () => {
    expect(notice("ALTER TABLE users ADD COLUMN tier ENUM('free','paid')")).toBeNull()
  })

  test('DROP COLUMN', () => {
    expect(notice('ALTER TABLE users DROP COLUMN nickname')).toBeNull()
  })

  test('CREATE TABLE and DML', () => {
    expect(notice('CREATE TABLE t (id INT)')).toBeNull()
    expect(notice("UPDATE users SET status = 'x' WHERE id = 1")).toBeNull()
  })

  test('the keyword inside a string literal does not count', () => {
    expect(notice("UPDATE audit SET note = 'ALTER TABLE users MODIFY COLUMN age INT' WHERE id = 1")).toBeNull()
  })

  test('a non-MySQL engine is out of scope', () => {
    expect(redshiftReloadNotice('ALTER TABLE users MODIFY COLUMN age BIGINT', 'postgres')).toBeNull()
  })
})

describe('redshiftReloadTables', () => {
  test('dedupes by table and keeps statement order', () => {
    const out = redshiftReloadTables([
      'ALTER TABLE users MODIFY age INT',
      'ALTER TABLE users ALTER COLUMN status DROP DEFAULT',
      'ALTER TABLE bookings MODIFY total DECIMAL(10,2)',
      'ALTER TABLE logs ADD COLUMN note TEXT',
    ], 'mysql')
    expect(out.map((n) => n.table)).toEqual(['users', 'bookings'])
  })
})

describe('stripLiteralsAndComments identifier handling', () => {
  test('default still blanks backticks, so the syntax check is unchanged', () => {
    expect(stripLiteralsAndComments('SELECT `a;b` FROM t')).not.toContain(';')
    expect(stripLiteralsAndComments("SELECT 'a;b' FROM t")).not.toContain(';')
  })

  test('keepIdentifiers preserves the table name but still drops string literals', () => {
    expect(stripLiteralsAndComments('ALTER TABLE `users` MODIFY a INT', { keepIdentifiers: true }))
      .toBe('ALTER TABLE `users` MODIFY a INT')
    expect(stripLiteralsAndComments("SELECT 'x' FROM `t`", { keepIdentifiers: true })).toBe('SELECT  FROM `t`')
  })
})
