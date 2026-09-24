import { describe, expect, test } from 'bun:test'
import { isProductionEnvironment, isReplicaSource } from './dms'

// The catalog exactly as Checkpoint reported it on 24 Sep 2026 (PROD-9520). Two
// databases share the replicated schema and only the environment tells them apart,
// which is the whole reason the environment is part of the test.
const PROD_MYSQL = { schema: 'myt', environmentName: 'Production' }
const STAGING_MYSQL = { schema: 'myt', environmentName: 'staging' }
const PROD_CHAT = { schema: 'chat', environmentName: 'Production' }

describe('isReplicaSource', () => {
  test('prod-mysql is the source', () => {
    expect(isReplicaSource(PROD_MYSQL, 'myt')).toBe(true)
  })

  test('staging-mysql, the same schema outside production, is not (PROD-9520)', () => {
    expect(isReplicaSource(STAGING_MYSQL, 'myt')).toBe(false)
  })

  test('prod-chat, production but another schema, is not', () => {
    expect(isReplicaSource(PROD_CHAT, 'myt')).toBe(false)
  })

  // Empty must fail closed: "any schema" would reload tables the task does not carry.
  test('an unset source schema matches nothing, never everything', () => {
    expect(isReplicaSource(PROD_MYSQL, '')).toBe(false)
  })

  // The environments join is LEFT, so a database whose environment row is gone
  // arrives with null; it must not be treated as prod.
  test('a database with no environment fails closed', () => {
    expect(isReplicaSource({ schema: 'myt', environmentName: null }, 'myt')).toBe(false)
  })
})

describe('isProductionEnvironment', () => {
  test('matches the spellings a production environment carries', () => {
    for (const name of ['production', 'Production', 'PRODUCTION', 'prod', ' production ']) {
      expect(isProductionEnvironment(name)).toBe(true)
    }
  })

  test('matches nothing else', () => {
    for (const name of ['staging', 'development', '', null, undefined]) {
      expect(isProductionEnvironment(name)).toBe(false)
    }
  })
})
