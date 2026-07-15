import { describe, expect, test } from 'bun:test'
import { canRelease } from './migrations'
import type { SessionUser, UserRole } from '../types'

const user = (role: UserRole, email = `${role}@myt.com`): SessionUser =>
  ({ id: `u_${role}`, email, name: role, picture: null, role })

describe('canRelease — deployment (deploy-gated) migrations', () => {
  test('admin and deployer can release', () => {
    expect(canRelease(true, [], user('admin'))).toBe(true)
    expect(canRelease(true, [], user('deployer'))).toBe(true)
  })

  test('editor and viewer cannot, even when listed as releasers', () => {
    for (const role of ['editor', 'viewer'] as const) {
      expect(canRelease(true, [], user(role))).toBe(false)
      expect(canRelease(true, [`${role}@myt.com`], user(role))).toBe(false)
    }
  })

  test('the ALL_USERS sentinel is not honored', () => {
    expect(canRelease(true, ['*'], user('editor'))).toBe(false)
    expect(canRelease(true, ['*'], user('viewer'))).toBe(false)
  })
})

describe('canRelease — standard migrations (unchanged behavior)', () => {
  test('admin always can', () => {
    expect(canRelease(false, [], user('admin'))).toBe(true)
  })

  test('non-admins only when listed or via ALL_USERS', () => {
    for (const role of ['editor', 'deployer', 'viewer'] as const) {
      expect(canRelease(false, [], user(role))).toBe(false)
      expect(canRelease(false, [`${role}@myt.com`], user(role))).toBe(true)
      expect(canRelease(false, ['*'], user(role))).toBe(true)
    }
  })

  test('listing is by exact email', () => {
    expect(canRelease(false, ['someone-else@myt.com'], user('editor'))).toBe(false)
  })
})
