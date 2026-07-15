import { describe, expect, test } from 'bun:test'
import { can, type Capability } from './auth'
import type { UserRole } from '../types'

// Full role × capability matrix — the single source of truth for RBAC.
const MATRIX: Record<UserRole, Record<Capability, boolean>> = {
  admin: { edit: true, approve: true, manage_users: true, apply_gated: true },
  editor: { edit: true, approve: false, manage_users: false, apply_gated: false },
  deployer: { edit: false, approve: false, manage_users: false, apply_gated: true },
  viewer: { edit: false, approve: false, manage_users: false, apply_gated: false },
}

describe('can', () => {
  for (const [role, caps] of Object.entries(MATRIX)) {
    for (const [capability, allowed] of Object.entries(caps)) {
      test(`${role} ${allowed ? 'has' : 'lacks'} ${capability}`, () => {
        expect(can(role as UserRole, capability as Capability)).toBe(allowed)
      })
    }
  }

  test('no role grants nothing', () => {
    expect(can(undefined, 'edit')).toBe(false)
  })
})
