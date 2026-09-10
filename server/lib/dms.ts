// AWS DMS client for the MySQL -> Redshift replica: read per-table state, request a
// reload. Why either is needed is in src/lib/redshiftReload.ts.
//
// Credentials come from the standard AWS provider chain (instance/task role, or
// AWS_* env vars), never from Checkpoint's own secret store.

import {
  DatabaseMigrationServiceClient,
  DescribeTableStatisticsCommand,
  ReloadTablesCommand,
} from '@aws-sdk/client-database-migration-service'

// us-east-1 out of arn:aws:dms:us-east-1:<account>:task:<id>. The task ARN is the
// only region source, so moving the task needs no second config change.
export function regionFromArn(arn: string): string | null {
  const parts = arn.split(':')
  return parts.length > 3 && parts[3] ? parts[3] : null
}

let client: DatabaseMigrationServiceClient | null = null

function dms(taskArn: string): DatabaseMigrationServiceClient {
  if (!client) {
    const region = regionFromArn(taskArn)
    if (!region) throw new Error(`Cannot read a region from DMS_TASK_ARN: ${taskArn}`)
    client = new DatabaseMigrationServiceClient({ region })
  }
  return client
}

export interface BrokenTable {
  schema: string
  table: string
  state: string
}

// States meaning the table has stopped replicating and needs intervention.
// "Table is being reloaded" is deliberately absent: a reload already in flight must
// not be counted as a fresh failure on the next poll.
const BROKEN_STATES = new Set(['Table error', 'Table cancelled'])

// Every table the task currently reports as broken. Paginated by hand: the task
// carries hundreds of tables and one page would silently truncate the answer.
export async function describeBrokenTables(taskArn: string): Promise<BrokenTable[]> {
  const c = dms(taskArn)
  const out: BrokenTable[] = []
  let marker: string | undefined
  // Bounded so a marker that never clears cannot spin forever.
  for (let page = 0; page < 50; page++) {
    const res = await c.send(new DescribeTableStatisticsCommand({
      ReplicationTaskArn: taskArn,
      MaxRecords: 500,
      Marker: marker,
    }))
    for (const t of res.TableStatistics ?? []) {
      if (t.TableState && BROKEN_STATES.has(t.TableState)) {
        out.push({ schema: t.SchemaName ?? '', table: t.TableName ?? '', state: t.TableState })
      }
    }
    marker = res.Marker
    if (!marker) break
  }
  return out
}

// Request a full reload of the given tables — one call for the whole set. The reload
// is asynchronous: DMS acknowledges the request and reloads in the background, so a
// resolved promise means "queued", not "finished".
export async function reloadTables(taskArn: string, schema: string, tables: string[]): Promise<void> {
  if (tables.length === 0) return
  await dms(taskArn).send(new ReloadTablesCommand({
    ReplicationTaskArn: taskArn,
    TablesToReload: tables.map((t) => ({ SchemaName: schema, TableName: t })),
    ReloadOption: 'data-reload',
  }))
}
