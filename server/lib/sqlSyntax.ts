import { Parser } from 'node-sql-parser'

// node-sql-parser dialect per engine (mirrors src/lib/sqlSyntax.ts). Engines
// missing here have no grammar, so their statements aren't syntax-checked.
const PARSER_DIALECT: Record<string, string> = {
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

export const MULTI_STATEMENT_ERROR =
  'Multiple SQL statements in one block — use one statement per block (add another statement box).'

// Blank out string literals ('…', "…", `…`) and comments (--, #, /* */) so a
// `;` scan only sees statement separators. Single pass, because a `--` inside a
// string isn't a comment and a quote inside a comment doesn't open a string.
function stripLiteralsAndComments(sql: string): string {
  let out = ''
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]
    if (c === "'" || c === '"' || c === '`') {
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

// Returns a human-readable syntax error for the statement, or null when it
// parses (or the engine has no grammar to check against). Multi-statement
// blocks are always rejected: each is executed as a single query, on a
// connection without multipleStatements.
export function checkSyntax(sql: string, engine: string): string | null {
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
    const raw = (e.message ?? 'Invalid SQL syntax').replace(/\s+/g, ' ')
    const message = raw.length > 160 ? `${raw.slice(0, 160)}…` : raw
    return `Syntax error${where}: ${message}`
  }
}
