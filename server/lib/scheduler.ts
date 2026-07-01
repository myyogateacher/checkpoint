// Background job that auto-applies migrations whose scheduled time has passed.
// Uses Bun's in-process cron (https://bun.com/docs/runtime/cron) to fire every
// minute — coarse enough for scheduled migrations. Each due migration is applied
// via the same applyMigrationNow helper the manual apply route uses, so it records
// events, audit entries and Slack notifications identically.
//
// Bun cron interprets schedules in UTC (the server already runs with TZ=UTC).

import { dueScheduledMigrations, applyMigrationNow } from '../modules/migrations'
import { env } from '../env'

// Every minute.
const CRON_SCHEDULE = '* * * * *'

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

export function startScheduler(): void {
  const job = Bun.cron(CRON_SCHEDULE, () => void tick())
  // Don't keep the process alive solely for the cron job.
  job.unref()
  console.log(`[scheduler] started (cron "${CRON_SCHEDULE}")`)
}
