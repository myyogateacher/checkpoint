// AWS DMS client for the MySQL -> Redshift replica: read per-table state, request a
// reload, and decide which managed database is the task's source. Why the first two
// are needed is in src/lib/redshiftReload.ts.
//
// Credentials come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, not from
// Checkpoint's own secret store. The key needs exactly two actions on the task,
// dms:DescribeTableStatistics and dms:ReloadTables, so it is worthless anywhere else.

import {
  DatabaseMigrationServiceClient,
  DescribeTableStatisticsCommand,
  ReloadTablesCommand,
} from '@aws-sdk/client-database-migration-service'
import { env } from '../env'

// us-east-1 out of arn:aws:dms:us-east-1:<account>:task:<id>. The task ARN is the
// only region source, so moving the task needs no second config change.
export function regionFromArn(arn: string): string | null {
  const parts = arn.split(':')
  return parts.length > 3 && parts[3] ? parts[3] : null
}

// Whether a managed database's write connection is the MySQL this task replicates
// from, and so whether DDL applied through it can break the Redshift copy.
//
// Host AND schema, never schema alone. PROD-9520: prod-mysql and staging-mysql are
// both schema `myt` and there is one task, so a schema-only match sent a staging
// apply's reload to the prod table. The host is compared case-insensitively because
// DNS is, and a connection form and a compose file are two places to type the same
// name; the schema is compared exactly because MySQL on Linux does. An unset host or
// schema matches nothing, never everything.
//
// Shared by the apply-time gate (modules/migrations.ts) and the catalog flag the
// migration form reads (databases.repo.ts replicates_to_redshift), so the notice an
// author sees and the reload that fires cannot disagree about which database counts.
export function isReplicaSource(
  conn: { host: string; database: string },
  source: { sourceHost: string; sourceSchema: string },
): boolean {
  if (!source.sourceHost || !source.sourceSchema) return false
  return conn.host.trim().toLowerCase() === source.sourceHost.toLowerCase()
    && conn.database === source.sourceSchema
}

let client: DatabaseMigrationServiceClient | null = null

function dms(taskArn: string): DatabaseMigrationServiceClient {
  if (!client) {
    const region = regionFromArn(taskArn)
    if (!region) throw new Error(`Cannot read a region from DMS_TASK_ARN: ${taskArn}`)
    const { accessKeyId, secretAccessKey } = env.dms
    if (!accessKeyId || !secretAccessKey) {
      // Said plainly here rather than letting the SDK hunt for an instance role that
      // does not exist and time out against the metadata endpoint.
      throw new Error('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required for the DMS replica features.')
    }
    client = new DatabaseMigrationServiceClient({ region, credentials: { accessKeyId, secretAccessKey } })
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
