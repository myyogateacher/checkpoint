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

// Parse a single SQL statement; returns a human-readable syntax error, or null
// when the statement parses (or the engine has no grammar to check against).
export function checkSyntax(sql: string, engine: DatabaseEngine): string | null {
  const database = PARSER_DIALECT[engine]
  if (!database) return null
  try {
    new Parser().astify(sql, { database })
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
