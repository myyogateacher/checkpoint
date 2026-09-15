import { stripLiteralsAndComments } from './sqlSyntax'

// Which MySQL DDL breaks the MySQL -> Redshift DMS replica.
//
// DMS applies most source DDL to a Redshift target, but a few statements it either
// cannot apply or never captures from the binlog. When that happens DMS suspends
// that one table (TableErrorPolicy defaults to SUSPEND_TABLE) and leaves the task
// itself "running", so nothing alarms while the warehouse quietly goes stale. The
// only recovery is a full reload of that table.
//
// The list below is the set confirmed with infra, not a guess:
//   MODIFY / CHANGE COLUMN   (includes a type change, and NULL / NOT NULL)
//   SET DEFAULT / DROP DEFAULT
//   character set or collation change
//   adding a value to an ENUM or SET (it rewrites the column definition)
//
// Plain ADD COLUMN and DROP COLUMN are replicated and need no reload.

export interface ReloadNotice {
  // Table as written in the statement, schema qualifier stripped.
  table: string
  // Shown to the author before they submit, and repeated in the apply notification.
  reason: string
}

// Only the MySQL family is a DMS source here; the same DDL on Postgres is a
// different question and is not covered.
const MYSQL_ENGINES = new Set(['mysql', 'aurora_mysql', 'mariadb', 'tidb'])

const ALTER_TABLE = /\balter\s+table\s+(?:if\s+exists\s+)?([`"\w.]+)/i

// Strip backticks/quotes and any schema qualifier: `myyogateacher`.`users` -> users
function bareTable(raw: string): string {
  const parts = raw.replace(/[`"]/g, '').split('.')
  return parts[parts.length - 1] ?? raw
}

// The reason this statement needs a reload, or null when it does not. One statement
// alters one table, so a statement yields at most one notice.
export function redshiftReloadNotice(sql: string, engine: string): ReloadNotice | null {
  if (!MYSQL_ENGINES.has(engine)) return null
  // Comments and string literals are blanked first so a keyword inside a default
  // value or a comment cannot trigger a needless reload. Backticked identifiers are
  // kept: `users` is the table name we need, not a literal to discard.
  const clean = stripLiteralsAndComments(sql, { keepIdentifiers: true })
  const m = ALTER_TABLE.exec(clean)
  if (!m) return null
  const table = bareTable(m[1])

  const modifies = /\bmodify\s+(?:column\s+)?/i.test(clean) || /\bchange\s+(?:column\s+)?/i.test(clean)

  // Most specific first: an ENUM/SET edit is a MODIFY, but it has its own advice.
  if (modifies && /\b(?:enum|set)\s*\(/i.test(clean)) {
    return {
      table,
      reason: 'Changes an ENUM/SET definition. DMS cannot apply it to Redshift, so the table needs a reload. A varchar column avoids this next time.',
    }
  }
  if (modifies) {
    return {
      table,
      reason: 'MODIFY/CHANGE COLUMN (type, or NULL/NOT NULL) is not applied to the Redshift target, so the table needs a reload.',
    }
  }
  if (/\balter\s+(?:column\s+)?[`"\w]+\s+(?:set|drop)\s+default\b/i.test(clean)) {
    return {
      table,
      reason: 'A default value change is not replicated to Redshift, so the table needs a reload.',
    }
  }
  // CONVERT TO is unambiguous. A bare CHARACTER SET / COLLATE only counts when the
  // statement has no ADD clause, otherwise it is just a new column's own charset.
  const convert = /\bconvert\s+to\s+character\s+set\b/i.test(clean)
  const tableLevelCharset =
    !/\badd\s+/i.test(clean) && /\b(?:character\s+set|charset|collate)\s*=?\s*[`"\w]+/i.test(clean)
  if (convert || tableLevelCharset) {
    return {
      table,
      reason: 'A character set or collation change is not replicated to Redshift, so the table needs a reload.',
    }
  }
  return null
}

// Distinct tables a whole migration will leave stale, in statement order. Used by
// the apply path to decide what to reload.
export function redshiftReloadTables(statements: string[], engine: string): ReloadNotice[] {
  const seen = new Set<string>()
  const out: ReloadNotice[] = []
  for (const sql of statements) {
    const notice = redshiftReloadNotice(sql, engine)
    if (!notice || seen.has(notice.table)) continue
    seen.add(notice.table)
    out.push(notice)
  }
  return out
}
