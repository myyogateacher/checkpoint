// What to do next about a DMS table that has stopped replicating.
//
// A reload fixes most of them. When it does not, the Redshift table's shape no
// longer matches the source and it has to be dropped so a reload recreates it. Both
// cases surface as the same Table Error, so the only thing that separates them is
// what we already tried, which is why this is a function of history.

export type Strategy =
  | 'reload'
  | 'schema_mismatch'
  | 'exhausted'
  // A recent attempt is still settling; a reload is not instant.
  | 'wait'

export interface RecoveryHistory {
  attempts: number
  lastStrategy: string | null
  lastAttemptAt: number | null // epoch ms
}

// `graceMs` is how long an attempt is given to take effect. A full load of a large
// table is not quick, and re-acting inside that window would stack reloads on top of
// each other and read as a permanent failure that is really just a slow one.
export function nextStrategy(history: RecoveryHistory | null, now: number, graceMs: number): Strategy {
  if (!history || history.attempts === 0) return 'reload'
  if (history.lastAttemptAt !== null && now - history.lastAttemptAt < graceMs) return 'wait'
  if (history.lastStrategy === 'reload') return 'schema_mismatch'
  return 'exhausted'
}

// Queued reloads, batched into the calls that will actually be made. ReloadTables takes
// one schema and a list of tables, so a migration that broke three tables is one call.
//
// Keyed on migration AND schema, not migration alone. A migration's statements can name
// two schemas, and folding them together would send one schema's table names under the
// other's, which the API accepts and which then reloads nothing while reporting success.
// That is the failure shape PROD-9445 was, so it does not get rebuilt here.
//
// The separator is NUL because it cannot appear in an identifier or an id, where a `|`
// or a `.` can, and a key collision here silently merges two migrations' reloads.
export function groupReloadsByTask<T extends { migration_id: string; schema_name: string }>(
  rows: T[],
): T[][] {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const key = `${row.migration_id}\u0000${row.schema_name}`
    const existing = groups.get(key)
    if (existing) existing.push(row)
    else groups.set(key, [row])
  }
  return [...groups.values()]
}
