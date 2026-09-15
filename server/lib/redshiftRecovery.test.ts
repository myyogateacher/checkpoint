import { describe, expect, test } from 'bun:test'
import { nextStrategy, type RecoveryHistory } from './redshiftRecovery'

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
