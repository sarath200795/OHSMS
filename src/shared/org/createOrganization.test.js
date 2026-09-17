import { describe, it, expect } from 'vitest'
import { ALL_MODULE_KEYS, isModuleEnabled } from '../modules/entitlements'
import { isPlaceholderMap } from '../modules/placeholders'
import { organizationCreatePayload } from './orgCreate'

describe('organizationCreatePayload', () => {
  const payload = organizationCreatePayload({
    orgName: 'Acme',
    address: 'Leeds',
    uid: 'u1',
    name: 'Ada Admin',
    email: 'ada@acme.test',
  })

  it('pins the founder as the org’s createdBy, which is what the placeholder rule checks', () => {
    expect(payload.org.createdBy).toBe('u1')
    expect(payload.org.name).toBe('Acme')
    expect(payload.user.role).toBe('admin')
    expect(payload.user.status).toBe('approved')
  })

  it('seeds a placeholder for every registry module, all inactive', () => {
    const { modules } = payload.entitlement
    expect(Object.keys(modules).sort()).toEqual([...ALL_MODULE_KEYS].sort())
    expect(isPlaceholderMap(modules)).toBe(true)
    for (const key of ALL_MODULE_KEYS) {
      expect(isModuleEnabled(modules, key), key).toBe(false)
    }
  })

  it('attributes the seed to the founder, not a platform operator', () => {
    expect(payload.entitlement.updatedBy).toBe('u1')
    expect(payload.entitlement.updatedByEmail).toBe('ada@acme.test')
  })

  it('does not record a suite — suites are an operator assignment, not a founder claim', () => {
    expect(payload.entitlement).not.toHaveProperty('suite')
  })
})
