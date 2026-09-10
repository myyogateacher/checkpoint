// Background job that auto-applies migrations whose scheduled time has passed.
// Uses Bun's in-process cron (https://bun.com/docs/runtime/cron) to fire every
// minute — coarse enough for scheduled migrations. Each due migration is applied
// via the same applyMigrationNow helper the manual apply route uses, so it records
// events, audit entries and Slack notifications identically.
//
// Bun cron interprets schedules in UTC (the server already runs with TZ=UTC).

import { dueScheduledMigrations, applyMigrationNow } from '../modules/migrations'
import { checkReplica } from '../modules/redshiftReplica'
import { env, ORG_LOCKED } from '../env'

// Every minute.
const CRON_SCHEDULE = '* * * * *'
// Every five minutes: DMS table state moves on CDC timescales, not seconds, and
// each tick is an AWS API call.
const REPLICA_CRON_SCHEDULE = '*/5 * * * *'

let ticking = false

async function tick(): Promise<void> {
  // Skip if the previous run is still going (a slow apply must not overlap).
  if (ticking) return
  ticking = true
  try {
    const due = await dueScheduledMigrations()
    for (const mig of due) {
      try {
        await applyMigrationNow(mig, mig.scheduled_by ?? 'system', env.appBaseUrl)
        console.log(`[scheduler] applied scheduled migration ${mig.id}`)
      } catch (err) {
        // applyMigrationNow already marked the migration failed and logged an event;
        // swallow here so one failure doesn't block the rest of the batch.
        console.error(`[scheduler] scheduled migration ${mig.id} failed: ${(err as Error).message}`)
      }
    }
  } catch (err) {
    console.error(`[scheduler] poll failed: ${(err as Error).message}`)
  } finally {
    ticking = false
  }
}

let replicaTicking = false

async function replicaTick(): Promise<void> {
  // A slow AWS round trip must not overlap the next tick.
  if (replicaTicking) return
  replicaTicking = true
  try {
    await checkReplica()
  } catch (err) {
    // Never let an AWS or Slack hiccup take the scheduler down.
    console.error(`[dms] replica check failed: ${(err as Error).message}`)
  } finally {
    replicaTicking = false
  }
}

export function startScheduler(): void {
  const job = Bun.cron(CRON_SCHEDULE, () => void tick())
  // Don't keep the process alive solely for the cron job.
  job.unref()
  console.log(`[scheduler] started (cron "${CRON_SCHEDULE}")`)

  if (!env.dms.watchEnabled || !env.dms.taskArn) return
  if (!ORG_LOCKED) {
    // Alerts go to one org's Slack settings; with several orgs there is no single
    // right destination, so stay off rather than guess.
    console.warn('[dms] replica watch is enabled but the deployment is not org-locked — not starting.')
    return
  }
  const replicaJob = Bun.cron(REPLICA_CRON_SCHEDULE, () => void replicaTick())
  replicaJob.unref()
  console.log(`[dms] replica watch started (cron "${REPLICA_CRON_SCHEDULE}")`)
}
