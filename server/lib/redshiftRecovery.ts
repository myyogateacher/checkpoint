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

// --- Audit entries for a reload ----------------------------------------------

export type ReloadOutcome =
  // Auto-reload is off, so the tables stay stale until a person reloads them.
  | 'needed'
  // Rows written to dms_pending_reloads; the scheduler fires them after the delay.
  | 'queued'
  // DMS accepted the reload and is running it.
  | 'sent'
  // Either the queueing write or the DMS call failed; the tables stay stale.
  | 'failed'

// The audit row a reload outcome writes.
//
// Until this existed, reload activity was recorded only with addEvent() into
// migration_events, which feeds the migration detail timeline and Slack. The audit
// log never saw it, so `/audit?q=redshift` came back empty even on a day a reload
// had run, and docs/features.md:340 says every mutating action writes an audit
// entry. A DMS reload rewrites a warehouse table, which is about as mutating as it
// gets.
//
// The action is `migration.*` rather than `redshift.*` on purpose, and not to win a
// category. docs/features.md:337 sets the convention as `entity.verb`, and the
// entity these rows carry IS the migration (entity_type 'migration', entity_id the
// migration's id), because a reload only ever exists as the fallout of one. That the
// prefix also files them under Migration changes, where someone chasing a
// migration's effects is already looking, is the convention paying off rather than
// the reason for it.
//
// The summary leads with "Redshift reload" so the audit search, which covers summary
// and entity_label (auditScope in server/modules/audit.ts), matches the word
// "redshift" without depending on someone having put it in the migration's title.
export function reloadAuditEntry(
  outcome: ReloadOutcome,
  opts: { tables: string[]; dbName: string; detail?: string },
): { action: string; summary: string } {
  const list = opts.tables.join(', ')
  // Sorted by how the reader meets them, not alphabetically: what happened, then to
  // what, then where. The detail is last because it is the only part that can be long.
  const head: Record<ReloadOutcome, string> = {
    needed: `Redshift reload needed for ${list} after a migration on ${opts.dbName}`,
    queued: `Redshift reload queued for ${list} after a migration on ${opts.dbName}`,
    sent: `Redshift reload sent to DMS for ${list} after a migration on ${opts.dbName}`,
    failed: `Redshift reload failed for ${list} after a migration on ${opts.dbName}`,
  }
  const detail = opts.detail?.trim()
  return {
    action: `migration.redshift_reload_${outcome}`,
    summary: detail ? `${head[outcome]} — ${detail}` : head[outcome],
  }
}
