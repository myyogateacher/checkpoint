// Watches the MySQL -> Redshift DMS replica and recovers tables that fall out of it.
// What breaks replication in the first place is in src/lib/redshiftReload.ts.
//
// The flow mirrors what infra do by hand:
//   Table Error -> reload -> if still broken, the Redshift table's schema is stale,
//   so drop it and let the reload recreate it.
//
// Dropping is safe here only because Redshift is a replica: every row comes back
// from MySQL. It is gated on DMS_ALLOW_DROP, a configured Redshift connection, and
// the table still existing at the source.

import { query, queryOne, execute } from '../db/pool'
import { describeBrokenTables, reloadTables, type BrokenTable } from '../lib/dms'
import { nextStrategy, type RecoveryHistory, type Strategy } from '../lib/redshiftRecovery'
import { notifyOrg } from '../lib/slack'
import { getConnectionSecret, type ConnectionSecret } from './databases.repo'
import { applyStatements, runReadQuery } from '../lib/externalDb'
import { LOCKED_ORG_ID } from '../db/init'
import { env } from '../env'

interface RecoveryRow {
  attempts: number
  last_strategy: string | null
  last_attempt_at: Date | null
}

async function loadHistory(schema: string, table: string): Promise<RecoveryHistory | null> {
  const row = await queryOne<RecoveryRow>(
    'SELECT attempts, last_strategy, last_attempt_at FROM dms_table_recovery WHERE schema_name = :s AND table_name = :t',
    { s: schema, t: table },
  )
  if (!row) return null
  return {
    attempts: Number(row.attempts),
    lastStrategy: row.last_strategy,
    lastAttemptAt: row.last_attempt_at ? row.last_attempt_at.getTime() : null,
  }
}

export async function recordAttempt(schema: string, table: string, strategy: Strategy): Promise<void> {
  await execute(
    `INSERT INTO dms_table_recovery (schema_name, table_name, attempts, last_strategy, last_attempt_at)
     VALUES (:s, :t, 1, :strategy, NOW())
     ON DUPLICATE KEY UPDATE attempts = attempts + 1, last_strategy = :strategy, last_attempt_at = NOW(), resolved_at = NULL`,
    { s: schema, t: table, strategy },
  )
}

// A table that is no longer broken has recovered. Clearing the row means the next
// failure starts from 'reload' again instead of jumping straight to escalation.
//
// The grace window matters here, not just in nextStrategy: while a reload runs, DMS
// reports the table as "Table is being reloaded", which is not a broken state, so it
// drops out of the broken set. Clearing it then would wipe the fact that we already
// tried a reload, and a table that comes back still broken would be reloaded again
// forever instead of escalating to a drop. So only rows whose last attempt has had
// time to settle are eligible.
async function clearRecovered(stillBroken: Set<string>, graceMs: number): Promise<void> {
  const open = await query<{ schema_name: string; table_name: string; last_attempt_at: Date | null }>(
    'SELECT schema_name, table_name, last_attempt_at FROM dms_table_recovery WHERE resolved_at IS NULL',
  )
  const now = Date.now()
  for (const row of open) {
    if (stillBroken.has(`${row.schema_name}.${row.table_name}`)) continue
    if (row.last_attempt_at && now - row.last_attempt_at.getTime() < graceMs) continue
    await execute(
      'UPDATE dms_table_recovery SET resolved_at = NOW(), attempts = 0, last_strategy = NULL WHERE schema_name = :s AND table_name = :t',
      { s: row.schema_name, t: row.table_name },
    )
  }
}

function notify(text: string): Promise<void> {
  return notifyOrg(LOCKED_ORG_ID, text, env.dms.slackChannel || undefined)
}

// Schema and table names arrive from the DMS API and end up inside a DROP, so they
// are checked against a plain identifier before they are interpolated anywhere.
// Anything unusual is refused rather than quoted and hoped for.
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/

function isSafe(t: BrokenTable): boolean {
  return SAFE_IDENTIFIER.test(t.schema) && SAFE_IDENTIFIER.test(t.table)
}

// The Checkpoint database whose write connection points at the replicated schema.
// Resolved rather than configured: that database already exists here (migrations run
// against it), so asking for its id again would be a second place to get wrong.
async function sourceDatabase(): Promise<{ id: string; engine: string } | undefined> {
  if (!env.dms.sourceSchema) return undefined
  return queryOne<{ id: string; engine: string }>(
    `SELECT d.id, d.engine FROM \`databases\` d
       JOIN connections c ON c.database_id = d.id AND c.mode = 'write'
      WHERE c.db_name = :schema LIMIT 1`,
    { schema: env.dms.sourceSchema },
  )
}

// Does the table still exist in MySQL? Dropping the Redshift copy of a table that
// no longer has a source would destroy the last copy of that data. Returns null when
// the check cannot be made, which is treated as "do not drop".
async function existsAtSource(t: BrokenTable): Promise<boolean | null> {
  const db = await sourceDatabase()
  if (!db) return null
  const conn = await getConnectionSecret(db.id, 'read')
  if (!conn) return null
  try {
    // Identifiers are validated by isSafe() before this runs, so they are safe to
    // inline; runReadQuery takes no bind parameters.
    const res = await runReadQuery(
      db.engine,
      conn,
      `SELECT COUNT(*) AS n FROM information_schema.tables
        WHERE table_schema = '${t.schema}' AND table_name = '${t.table}'`,
      8000,
    )
    return Number(res.rows[0]?.n ?? 0) > 0
  } catch (err) {
    console.error(`[dms] source existence check failed for ${t.schema}.${t.table}: ${(err as Error).message}`)
    return null
  }
}

// The reload did not clear it, so the Redshift table's shape no longer matches the
// source. Drop it and reload, which recreates it with the current schema and data.
async function recoverSchemaMismatch(t: BrokenTable): Promise<void> {
  const manual = `DROP TABLE IF EXISTS ${t.schema}.${t.table};   -- then reload ${t.table} in DMS`
  const decline = (why: string) =>
    notify(`:warning: *Redshift schema mismatch* a reload did not fix \`${t.schema}.${t.table}\`, so the Redshift table no longer matches the source.\n${why}\nRun this by hand:\n\`\`\`${manual}\`\`\``)

  if (!isSafe(t)) return decline('The table name is not a plain identifier, so Checkpoint will not build a DROP for it.')
  if (!env.dms.allowDrop) return decline('Automatic drop is off (DMS_ALLOW_DROP).')
  if (!env.redshift.host) return decline('No Redshift connection is configured (REDSHIFT_HOST).')

  const exists = await existsAtSource(t)
  if (exists === null) return decline('Could not confirm the table still exists in MySQL, so it was left alone.')
  if (!exists) {
    return notify(`:rotating_light: *Redshift table has no source* \`${t.schema}.${t.table}\` is broken in DMS but does not exist in MySQL any more. Not dropping it — the Redshift copy may be the only one left.`)
  }

  const conn: ConnectionSecret = {
    host: env.redshift.host,
    port: env.redshift.port,
    username: env.redshift.username,
    database: env.redshift.database,
    ssl: env.redshift.ssl,
    password: env.redshift.password,
  }

  try {
    await applyStatements('redshift', conn, [`DROP TABLE IF EXISTS "${t.schema}"."${t.table}"`])
  } catch (err) {
    return decline(`The drop failed: ${(err as Error).message}`)
  }
  try {
    await reloadTables(env.dms.taskArn, t.schema, [t.table])
  } catch (err) {
    // Worst case to be loud about: the table is gone from Redshift and the reload
    // that would rebuild it did not start.
    return notify(`:rotating_light: *Redshift table dropped but not reloaded* \`${t.schema}.${t.table}\` was dropped and the DMS reload failed: ${(err as Error).message}\nThe table is missing from Redshift until a reload runs.`)
  }
  await notify(`:arrows_counterclockwise: *Redshift schema mismatch fixed* \`${t.schema}.${t.table}\` was dropped and reloaded, so DMS recreates it with the current schema. It reads incomplete until the load finishes.`)
}

// One pass: look at every broken table and take the next step for each.
export async function checkReplica(): Promise<void> {
  const broken = await describeBrokenTables(env.dms.taskArn)
  // Only tables from the schema this task replicates; the task may carry others.
  const mine = env.dms.sourceSchema
    ? broken.filter((t) => t.schema === env.dms.sourceSchema)
    : broken

  const graceMs = env.dms.retryGraceMinutes * 60_000
  await clearRecovered(new Set(mine.map((t) => `${t.schema}.${t.table}`)), graceMs)
  if (mine.length === 0) return

  const now = Date.now()
  const toReload: BrokenTable[] = []
  const mismatched: BrokenTable[] = []
  // Carries the previous strategy so a table that was already reported as
  // unrecoverable is not re-reported on every pass.
  const exhausted: { table: BrokenTable; alreadyReported: boolean }[] = []

  for (const t of mine) {
    const history = await loadHistory(t.schema, t.table)
    const strategy = nextStrategy(history, now, graceMs)
    if (strategy === 'wait') continue
    if (strategy === 'reload') toReload.push(t)
    else if (strategy === 'schema_mismatch') mismatched.push(t)
    else exhausted.push({ table: t, alreadyReported: history?.lastStrategy === 'exhausted' })
  }

  // Grouped by schema: ReloadTables takes one schema per entry, and with
  // DMS_SOURCE_SCHEMA unset the broken set can span several.
  const bySchema = new Map<string, BrokenTable[]>()
  for (const t of toReload) bySchema.set(t.schema, [...(bySchema.get(t.schema) ?? []), t])

  for (const [schema, group] of bySchema) {
    const names = group.map((t) => t.table)
    try {
      await reloadTables(env.dms.taskArn, schema, names)
      for (const t of group) await recordAttempt(t.schema, t.table, 'reload')
      await notify(`:arrows_counterclockwise: *Redshift replica* ${names.length} table(s) in \`${schema}\` had stopped replicating and a reload was requested:\n\`\`\`${names.join('\n')}\`\`\`\nThey read incomplete until the load finishes.`)
    } catch (err) {
      const message = (err as Error).message
      console.error(`[dms] reload failed for ${schema}: ${message}`)
      // Nothing recorded, so the next pass retries the reload rather than
      // escalating to a drop off the back of a call that never reached AWS.
      await notify(`:red_circle: *Redshift replica* reload failed for ${names.join(', ')}\n\`\`\`${message}\`\`\``)
    }
  }

  for (const t of mismatched) {
    // Recorded before the attempt, not after: if the drop or reload throws, the
    // table must still count as tried so the next pass escalates instead of
    // dropping it again.
    await recordAttempt(t.schema, t.table, 'schema_mismatch')
    await recoverSchemaMismatch(t)
  }

  for (const { table, alreadyReported } of exhausted) {
    await recordAttempt(table.schema, table.table, 'exhausted')
    // Said once. A table nothing automated can fix would otherwise post the same
    // alarm every grace window until someone deletes it, which trains people to
    // scroll past the channel.
    if (alreadyReported) continue
    await notify(`:rotating_light: *Redshift replica still broken* \`${table.schema}.${table.table}\` is still in ${table.state} after a reload and a drop. Nothing automated will fix this one.`)
  }
}
