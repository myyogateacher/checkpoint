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

// Returns a human-readable syntax error for the statement, or null when it
// parses (or the engine has no grammar to check against).
export function checkSyntax(sql: string, engine: string): string | null {
  const database = PARSER_DIALECT[engine]
  if (!database) return null
  try {
    new Parser().astify(sql, { database })
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
