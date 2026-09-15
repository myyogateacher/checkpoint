import { Parser } from 'node-sql-parser'
import type { DatabaseEngine } from '../types'

// node-sql-parser dialect per engine. Engines missing here (ClickHouse,
// Cassandra, …) have no parser grammar, so their syntax isn't checked — rule
// validation still applies.
const PARSER_DIALECT: Partial<Record<DatabaseEngine, string>> = {
  postgres: 'PostgresQL',
  aurora_postgres: 'PostgresQL',
  alloydb: 'PostgresQL',
  redshift: 'PostgresQL',
  mysql: 'MySQL',
  aurora_mysql: 'MySQL',
  tidb: 'MySQL',
  starrocks: 'MySQL',
  mariadb: 'MariaDB',
}

export function engineSupportsSyntaxCheck(engine: DatabaseEngine): boolean {
  return engine in PARSER_DIALECT
}

// Kept identical to the server's message (server/lib/sqlSyntax.ts).
export const MULTI_STATEMENT_ERROR =
  'Multiple SQL statements in one block — use one statement per block (add another statement box).'

// Blank out string literals ('…', "…", `…`) and comments (--, #, /* */) so a
// `;` scan only sees statement separators. Single pass, because a `--` inside a
// string isn't a comment and a quote inside a comment doesn't open a string.
export function stripLiteralsAndComments(sql: string, opts: { keepIdentifiers?: boolean } = {}): string {
  let out = ''
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]
    if (c === "'" || c === '"' || c === '`') {
      // Backticks quote identifiers, not strings. Callers that need to read the
      // table or column name back out (redshiftReload) keep them; the syntax
      // check blanks everything, which is why this is opt-in.
      const keep = opts.keepIdentifiers === true && c === '`'
      const start = i
      i++
      for (; i < sql.length; i++) {
        // Backslash escapes (MySQL) and the doubled-quote form both continue
        // the literal rather than closing it.
        if (c !== '`' && sql[i] === '\\') i++
        else if (sql[i] === c) {
          if (sql[i + 1] === c) i++
          else break
        }
      }
      if (keep) out += sql.slice(start, i + 1)
      continue
    }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      out += '\n'
      continue
    }
    if (c === '#') {
      while (i < sql.length && sql[i] !== '\n') i++
      out += '\n'
      continue
    }
    if (c === '/' && sql[i + 1] === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i++
      out += ' '
      continue
    }
    out += c
  }
  return out
}

// True when the block holds more than one statement — a `;` with anything but
// whitespace after it. A single trailing semicolon stays valid.
function hasMultipleStatements(sql: string): boolean {
  return /;\s*\S/.test(stripLiteralsAndComments(sql))
}

// Parse a single SQL statement; returns a human-readable syntax error, or null
// when the statement parses (or the engine has no grammar to check against).
// Multi-statement blocks are always rejected — each block is applied as one
// query on a connection without multipleStatements.
export function checkSyntax(sql: string, engine: DatabaseEngine): string | null {
  if (hasMultipleStatements(sql)) return MULTI_STATEMENT_ERROR
  const database = PARSER_DIALECT[engine]
  if (!database) return null
  try {
    const ast = new Parser().astify(sql, { database })
    // astify() returns an array when the SQL holds several statements.
    if (Array.isArray(ast) && ast.length > 1) return MULTI_STATEMENT_ERROR
    return null
  } catch (err) {
    const e = err as { message?: string; location?: { start?: { line: number; column: number } } }
    const loc = e.location?.start
    const where = loc ? ` (line ${loc.line}, column ${loc.column})` : ''
    // Parser messages enumerate every expected token and get very long — keep
    // the gist and truncate the tail.
    const raw = (e.message ?? 'Invalid SQL syntax').replace(/\s+/g, ' ')
    const message = raw.length > 160 ? `${raw.slice(0, 160)}…` : raw
    return `Syntax error${where}: ${message}`
  }
}
