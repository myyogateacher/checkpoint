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
