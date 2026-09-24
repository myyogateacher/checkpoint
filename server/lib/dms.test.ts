import { describe, expect, test } from 'bun:test'
import { isReplicaSource } from './dms'

// The two managed databases exactly as Checkpoint's catalog reported them on
// 24 Sep 2026 (PROD-9520): the same schema on two hosts. Schema alone cannot tell
// them apart, which is the whole reason the host is part of the test.
const PROD = { host: 'myt-prod.privatelink.mysql.database.azure.com', database: 'myt' }
const STAGING = { host: '164.52.210.111', database: 'myt' }
const SOURCE = { sourceHost: PROD.host, sourceSchema: 'myt' }

describe('isReplicaSource', () => {
  test('the prod write connection is the source', () => {
    expect(isReplicaSource(PROD, SOURCE)).toBe(true)
  })

  test('staging, the same schema on another host, is not (PROD-9520)', () => {
    expect(isReplicaSource(STAGING, SOURCE)).toBe(false)
  })

  test('another schema on the prod host is not', () => {
    expect(isReplicaSource({ ...PROD, database: 'chat' }, SOURCE)).toBe(false)
  })

  // An empty setting must fail closed. "Any host" is the pre-fix behaviour and "any
  // schema" would reload tables the task does not carry.
  test('an unset host or schema matches nothing, never everything', () => {
    expect(isReplicaSource(PROD, { ...SOURCE, sourceHost: '' })).toBe(false)
    expect(isReplicaSource(PROD, { ...SOURCE, sourceSchema: '' })).toBe(false)
  })

  // The host is typed twice, once in the connection form and once in compose, and
  // DNS does not care about case; the schema is exact because MySQL on Linux is.
  test('host case and whitespace are forgiven, schema case is not', () => {
    expect(isReplicaSource({ ...PROD, host: ` ${PROD.host.toUpperCase()} ` }, SOURCE)).toBe(true)
    expect(isReplicaSource({ ...PROD, database: 'MYT' }, SOURCE)).toBe(false)
  })
})
