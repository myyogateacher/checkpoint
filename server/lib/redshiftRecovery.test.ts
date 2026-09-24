import { describe, expect, test } from 'bun:test'
import { groupReloadsByTask, nextStrategy, reloadAuditEntry, type RecoveryHistory } from './redshiftRecovery'

const NOW = 1_757_500_000_000
const GRACE = 30 * 60_000
const h = (over: Partial<RecoveryHistory>): RecoveryHistory =>
  ({ attempts: 1, lastStrategy: 'reload', lastAttemptAt: NOW - GRACE - 1, ...over })

describe('nextStrategy', () => {
  test('a table seen for the first time is reloaded', () => {
    expect(nextStrategy(null, NOW, GRACE)).toBe('reload')
    expect(nextStrategy(h({ attempts: 0, lastStrategy: null, lastAttemptAt: null }), NOW, GRACE)).toBe('reload')
  })

  test('a recent attempt is left to settle', () => {
    expect(nextStrategy(h({ lastAttemptAt: NOW - 60_000 }), NOW, GRACE)).toBe('wait')
  })

  test('still broken after a reload means the Redshift schema is stale', () => {
    expect(nextStrategy(h({ lastStrategy: 'reload' }), NOW, GRACE)).toBe('schema_mismatch')
  })

  test('still broken after the drop-and-reload ask needs a person', () => {
    expect(nextStrategy(h({ attempts: 2, lastStrategy: 'schema_mismatch' }), NOW, GRACE)).toBe('exhausted')
  })

  test('the grace window is exclusive at its edge', () => {
    expect(nextStrategy(h({ lastAttemptAt: NOW - GRACE }), NOW, GRACE)).toBe('schema_mismatch')
    expect(nextStrategy(h({ lastAttemptAt: NOW - GRACE + 1 }), NOW, GRACE)).toBe('wait')
  })
})

describe('groupReloadsByTask', () => {
  const row = (migration_id: string, schema_name: string, table_name: string) =>
    ({ migration_id, schema_name, table_name })

  test('one migration touching three tables is one call, not three', () => {
    const groups = groupReloadsByTask([
      row('mig_1', 'myt', 'session'),
      row('mig_1', 'myt', 'recording_overrides'),
      row('mig_1', 'myt', 'student_discounts_and_extra_charges'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.map((r) => r.table_name)).toEqual([
      'session', 'recording_overrides', 'student_discounts_and_extra_charges',
    ])
  })

  // The reason the key carries the schema: merged, these two would send `audit` to DMS
  // under `myt`, which reloads nothing and reports success.
  test('two schemas in one migration stay separate calls', () => {
    const groups = groupReloadsByTask([
      row('mig_1', 'myt', 'session'),
      row('mig_1', 'reporting', 'audit'),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g[0]!.schema_name)).toEqual(['myt', 'reporting'])
  })

  test('two migrations on the same schema stay separate calls', () => {
    const groups = groupReloadsByTask([
      row('mig_1', 'myt', 'session'),
      row('mig_2', 'myt', 'session'),
    ])
    expect(groups).toHaveLength(2)
  })

  test('nothing due is no calls', () => {
    expect(groupReloadsByTask([])).toEqual([])
  })
})

describe('reloadAuditEntry', () => {
  const opts = { tables: ['session', 'recording_overrides'], dbName: 'myt' }

  test('every outcome is a migration.* action, so the audit category is Migration changes', () => {
    // CATEGORY_SQL files anything outside migration.*/schema.*/query.* under System
    // changes. A reload landing there is the bug this function exists to avoid: it is
    // a migration's fallout, and that is where someone goes looking for it.
    for (const outcome of ['needed', 'queued', 'sent', 'failed'] as const) {
      expect(reloadAuditEntry(outcome, opts).action.startsWith('migration.')).toBe(true)
    }
  })

  test('each outcome gets its own action, so the four are distinguishable in the log', () => {
    const actions = (['needed', 'queued', 'sent', 'failed'] as const).map((o) => reloadAuditEntry(o, opts).action)
    expect(new Set(actions).size).toBe(4)
    expect(actions).toEqual([
      'migration.redshift_reload_needed',
      'migration.redshift_reload_queued',
      'migration.redshift_reload_sent',
      'migration.redshift_reload_failed',
    ])
  })

  test('the summary carries the word the audit search is run with', () => {
    // The whole point: `/audit?q=redshift` was empty because no audit row anywhere
    // contained the word. The search covers summary, so every outcome must.
    for (const outcome of ['needed', 'queued', 'sent', 'failed'] as const) {
      expect(reloadAuditEntry(outcome, opts).summary.toLowerCase()).toContain('redshift')
    }
  })

  test('the summary names every table and the database', () => {
    const { summary } = reloadAuditEntry('sent', opts)
    expect(summary).toContain('session')
    expect(summary).toContain('recording_overrides')
    expect(summary).toContain('myt')
  })

  test('a detail is appended, and a blank one adds no trailing separator', () => {
    expect(reloadAuditEntry('failed', { ...opts, detail: 'AccessDenied' }).summary).toContain('— AccessDenied')
    for (const detail of [undefined, '', '   ']) {
      expect(reloadAuditEntry('queued', { ...opts, detail }).summary.endsWith(`on ${opts.dbName}`)).toBe(true)
    }
  })
})
