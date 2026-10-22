import { describe, it, expect } from 'vitest'
import {
  allowOrgTest,
  clickToChatLink,
  memberPhoneMatches,
  membersMatchingPhone,
  normalizeWaId,
  orgLookupEnabled,
  ORG_TEST_LIMIT,
  planAddLink,
  planRemoveLink,
  presentConnect,
  requireOrgAdmin,
  testMessageText,
} from './orgConnect.js'

const admin = (extra = {}) => ({
  uid: 'admin1',
  orgId: 'orgA',
  role: 'admin',
  status: 'approved',
  ...extra,
})

const member = (extra = {}) => ({
  uid: 'u1',
  orgId: 'orgA',
  role: 'member',
  status: 'approved',
  name: 'Asha Example',
  ...extra,
})

describe('normalizeWaId', () => {
  it('keeps a country-coded number and drops formatting', () => {
    expect(normalizeWaId('+91 90000 00001')).toBe('919000000001')
    expect(normalizeWaId('919000000001')).toBe('919000000001')
  })

  it('refuses a local number, a leading zero, and prose that contains digits', () => {
    expect(normalizeWaId('9000000001')).toBeNull()
    expect(normalizeWaId('00919000000001')).toBeNull()
    expect(normalizeWaId('call me on 919000000001')).toBeNull()
    expect(normalizeWaId('')).toBeNull()
    expect(normalizeWaId('+91')).toBeNull()
  })
})

describe('clickToChatLink', () => {
  it('builds a wa.me link and nothing else', () => {
    expect(clickToChatLink('+91 90000 00001')).toBe('https://wa.me/919000000001')
    expect(clickToChatLink('not a number')).toBeNull()
    expect(clickToChatLink('javascript:alert(1)')).toBeNull()
  })
})

describe('orgLookupEnabled', () => {
  it('stays on until an administrator explicitly turns it off', () => {
    expect(orgLookupEnabled(null)).toBe(true)
    expect(orgLookupEnabled(undefined)).toBe(true)
    expect(orgLookupEnabled({})).toBe(true)
    expect(orgLookupEnabled({ enabled: true })).toBe(true)
    expect(orgLookupEnabled({ enabled: 'false' })).toBe(true)
    expect(orgLookupEnabled({ enabled: false })).toBe(false)
  })
})

describe('requireOrgAdmin', () => {
  it('accepts an approved admin and refuses everyone else', () => {
    expect(requireOrgAdmin(admin()).ok).toBe(true)
    expect(requireOrgAdmin(admin({ role: 'manager' })).code).toBe('permission-denied')
    expect(requireOrgAdmin(admin({ role: 'auditor' })).code).toBe('permission-denied')
    expect(requireOrgAdmin(admin({ status: 'suspended' })).code).toBe('permission-denied')
    expect(requireOrgAdmin(admin({ mustChangePassword: true })).code).toBe('permission-denied')
    expect(requireOrgAdmin(null).code).toBe('permission-denied')
  })

  it('uses the profile organisation, not one a caller could supply', () => {
    expect(requireOrgAdmin(admin()).orgId).toBe('orgA')
  })
})

describe('planAddLink', () => {
  const base = { orgId: 'orgA', members: [], existingPhone: null }

  it('binds a chosen approved member', () => {
    const plan = planAddLink({
      ...base,
      phone: '+91 90000 00001',
      memberUid: 'u1',
      chosen: member(),
    })
    expect(plan).toMatchObject({ ok: true, waId: '919000000001', uid: 'u1', mapped: 'chosen' })
  })

  it('maps a profile phone when no employee was chosen', () => {
    const plan = planAddLink({
      ...base,
      phone: '919000000001',
      memberUid: '',
      members: [
        member({ phone: '+91 90000 00001' }),
        member({ uid: 'u2', mobile: '918888888888' }),
      ],
    })
    expect(plan).toMatchObject({ ok: true, uid: 'u1', mapped: 'phone' })
  })

  it('does not treat prose, or a suspended profile, as a match', () => {
    expect(memberPhoneMatches(member({ phone: 'ring 919000000001 please' }), '919000000001')).toBe(
      false
    )
    const plan = planAddLink({
      ...base,
      phone: '919000000001',
      memberUid: '',
      members: [member({ status: 'suspended', phone: '919000000001' })],
    })
    expect(plan.ok).toBe(false)
    expect(membersMatchingPhone([member({ phone: '919000000001' })], '919000000001')).toHaveLength(
      1
    )
  })

  it('asks the admin to choose when several profiles share the number', () => {
    const plan = planAddLink({
      ...base,
      phone: '919000000001',
      memberUid: '',
      members: [
        member({ phone: '919000000001' }),
        member({ uid: 'u2', mobile: '+91 90000 00001' }),
      ],
    })
    expect(plan.ok).toBe(false)
    expect(plan.message).toMatch(/Choose one/)
  })

  it('refuses a person outside the organisation, an inactive member, and a path-like uid', () => {
    expect(
      planAddLink({
        ...base,
        phone: '919000000001',
        memberUid: 'u9',
        chosen: member({ orgId: 'orgB' }),
      }).ok
    ).toBe(false)
    expect(
      planAddLink({
        ...base,
        phone: '919000000001',
        memberUid: 'u1',
        chosen: member({ status: 'pending' }),
      }).code
    ).toBe('failed-precondition')
    expect(
      planAddLink({ ...base, phone: '919000000001', memberUid: 'a/b', chosen: member() }).ok
    ).toBe(false)
  })

  it('will not take a number from another organisation or from another member', () => {
    expect(
      planAddLink({
        ...base,
        phone: '919000000001',
        memberUid: 'u1',
        chosen: member(),
        existingPhone: { orgId: 'orgB', uid: 'other' },
      }).code
    ).toBe('already-exists')
    expect(
      planAddLink({
        ...base,
        phone: '919000000001',
        memberUid: 'u1',
        chosen: member(),
        existingPhone: { orgId: 'orgA', uid: 'u2' },
      }).message
    ).toMatch(/someone else/)
  })

  it('refuses an automatic match when the member scan was truncated', () => {
    const plan = planAddLink({
      ...base,
      phone: '919000000001',
      memberUid: '',
      members: [member({ phone: '919000000001' })],
      memberScanTruncated: true,
    })
    expect(plan.ok).toBe(false)
  })
})

describe('planRemoveLink', () => {
  it('removes only a number linked to this organisation', () => {
    expect(
      planRemoveLink({
        phone: '919000000001',
        existing: { orgId: 'orgA', uid: 'u1' },
        orgId: 'orgA',
      }).ok
    ).toBe(true)
    expect(
      planRemoveLink({
        phone: '919000000001',
        existing: { orgId: 'orgB', uid: 'u1' },
        orgId: 'orgA',
      }).code
    ).toBe('not-found')
    expect(planRemoveLink({ phone: '919000000001', existing: null, orgId: 'orgA' }).code).toBe(
      'not-found'
    )
  })
})

describe('presentConnect', () => {
  it('names every field and drops anything else on the settings document', () => {
    const status = presentConnect({
      platformReady: true,
      displayNumber: '+91 90000 00001',
      settings: {
        enabled: false,
        WA_ACCESS_TOKEN: 'sekret',
        WA_APP_SECRET: 'sekret',
        verify: 'sekret',
      },
      links: [
        {
          id: '919000000001',
          uid: 'u1',
          orgId: 'orgA',
          source: 'admin',
          linkedAtMs: 10,
          token: 'sekret',
        },
      ],
      membersByUid: new Map([['u1', member()]]),
    })
    expect(JSON.stringify(status)).not.toContain('sekret')
    expect(Object.keys(status).sort()).toEqual([
      'chatLink',
      'enabled',
      'links',
      'number',
      'platformReady',
      'truncated',
    ])
    expect(status.enabled).toBe(false)
    expect(status.chatLink).toBe('https://wa.me/919000000001')
    expect(status.links[0]).toEqual({
      phone: '919000000001',
      masked: '•••• 0001',
      uid: 'u1',
      active: true,
      linkedAt: 10,
      source: 'admin',
    })
  })

  it('does not publish a click-to-chat link when the display value is not a number', () => {
    const status = presentConnect({
      platformReady: false,
      displayNumber: '',
      settings: null,
      links: [],
      membersByUid: new Map(),
    })
    expect(status.chatLink).toBeNull()
    expect(status.number).toBeNull()
    expect(status.enabled).toBe(true)
    expect(status.platformReady).toBe(false)
  })
})

describe('allowOrgTest', () => {
  const start = new Date('2026-10-22T12:00:00Z')

  it('allows five tests an hour and then refuses, without dropping the enabled flag', () => {
    let state = { enabled: false }
    for (let i = 0; i < ORG_TEST_LIMIT; i += 1) {
      const out = allowOrgTest(state, start)
      expect(out.allowed).toBe(true)
      state = out.state
    }
    expect(state.enabled).toBe(false)
    expect(allowOrgTest(state, new Date(start.getTime() + 1000)).allowed).toBe(false)
    expect(allowOrgTest(state, new Date(start.getTime() + 60 * 60 * 1000)).allowed).toBe(true)
  })
})

describe('testMessageText', () => {
  it('says whether lookup is on, and strips formatting from the organisation name', () => {
    expect(testMessageText('*Acme*', true)).toContain('on for Acme')
    expect(testMessageText('*Acme*', true)).not.toContain('*')
    expect(testMessageText('Acme', false)).toContain('switched off')
    expect(testMessageText('Acme', false)).not.toContain('WA_ACCESS_TOKEN')
  })
})
