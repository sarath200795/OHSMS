import { describe, it, expect } from 'vitest'
import { memoryDb } from '../../test-support/memoryDb.js'
import {
  addOrgNumber,
  prepareOrgTest,
  readOrgConnect,
  removeOrgNumber,
  setOrgEnabled,
} from './orgAdmin.js'

const admin = {
  uid: 'admin1',
  orgId: 'orgA',
  role: 'admin',
  status: 'approved',
  name: 'Ada Admin',
}

function seed(extra = {}) {
  return memoryDb({
    'users/admin1': { ...admin },
    'users/u1': {
      orgId: 'orgA',
      role: 'member',
      status: 'approved',
      name: 'Asha Example',
      phone: '+91 90000 00001',
    },
    'users/u2': { orgId: 'orgA', role: 'member', status: 'approved', name: 'Ben Example' },
    'users/outsider': { orgId: 'orgB', role: 'member', status: 'approved', name: 'Other Org' },
    'organizations/orgA': { name: 'Acme Fitness' },
    ...extra,
  })
}

describe('readOrgConnect', () => {
  it('returns this organisation only, with no secret-shaped fields', async () => {
    const db = seed({
      'waLinks/919000000001': { uid: 'u1', orgId: 'orgA', source: 'admin', linkedAtMs: 5 },
      'waLinks/441234567890': { uid: 'outsider', orgId: 'orgB', source: 'self' },
      'waOrgSettings/orgA': { enabled: true, WA_ACCESS_TOKEN: 'sekret' },
    })
    const status = await readOrgConnect(db, {
      user: admin,
      platformReady: true,
      displayNumber: '+91 98000 00000',
    })
    expect(status.ok).toBe(true)
    expect(status.links.map((l) => l.phone)).toEqual(['919000000001'])
    expect(status.chatLink).toBe('https://wa.me/919800000000')
    expect(JSON.stringify(status)).not.toContain('sekret')
  })

  it('refuses a manager and an admin of a different story who is not approved', async () => {
    const db = seed()
    const manager = await readOrgConnect(db, { user: { ...admin, role: 'manager' } })
    expect(manager.code).toBe('permission-denied')
    const pending = await readOrgConnect(db, { user: { ...admin, status: 'pending' } })
    expect(pending.code).toBe('permission-denied')
  })
})

describe('setOrgEnabled', () => {
  it('writes only the switch', async () => {
    const db = seed({ 'waOrgSettings/orgA': { testCount: 2, enabled: true } })
    const out = await setOrgEnabled(db, { user: admin, enabled: false, now: new Date(1000) })
    expect(out).toEqual({ ok: true, enabled: false })
    const saved = db.store.get('waOrgSettings/orgA')
    expect(saved.enabled).toBe(false)
    expect(saved.updatedBy).toBe('admin1')
    expect(saved.testCount).toBe(2)
    expect(saved.WA_ACCESS_TOKEN).toBeUndefined()
    const bad = await setOrgEnabled(db, { user: admin, enabled: 'false' })
    expect(bad.code).toBe('invalid-argument')
  })
})

describe('addOrgNumber', () => {
  it('binds the number to the chosen member and drops their previous handset', async () => {
    const db = seed({
      'waLinks/918888888888': { uid: 'u2', orgId: 'orgA', source: 'self' },
    })
    const out = await addOrgNumber(db, {
      user: admin,
      phone: '+91 90000 00002',
      memberUid: 'u2',
      now: new Date(2000),
    })
    expect(out).toMatchObject({ ok: true, phone: '919000000002', uid: 'u2', mapped: 'chosen' })
    expect(db.store.get('waLinks/919000000002')).toMatchObject({
      uid: 'u2',
      orgId: 'orgA',
      source: 'admin',
      linkedBy: 'admin1',
    })
    expect(db.store.has('waLinks/918888888888')).toBe(false)
    expect(Object.keys(db.store.get('waLinks/919000000002'))).not.toContain('WA_ACCESS_TOKEN')
  })

  it('maps a profile number when the admin does not pick someone', async () => {
    const db = seed()
    const out = await addOrgNumber(db, { user: admin, phone: '919000000001', memberUid: '' })
    expect(out).toMatchObject({ ok: true, uid: 'u1', mapped: 'phone' })
  })

  it('refuses another organisation, another member, and a uid that is not a profile id', async () => {
    const db = seed({
      'waLinks/919000000009': { uid: 'outsider', orgId: 'orgB' },
      'waLinks/919000000008': { uid: 'u1', orgId: 'orgA' },
    })
    expect(
      (await addOrgNumber(db, { user: admin, phone: '919000000009', memberUid: 'u2' })).code
    ).toBe('already-exists')
    expect(db.store.get('waLinks/919000000009').orgId).toBe('orgB')
    expect(
      (await addOrgNumber(db, { user: admin, phone: '919000000008', memberUid: 'u2' })).code
    ).toBe('already-exists')
    expect(
      (await addOrgNumber(db, { user: admin, phone: '919000000001', memberUid: 'outsider' })).code
    ).toBe('invalid-argument')
    expect(
      (await addOrgNumber(db, { user: admin, phone: '919000000001', memberUid: 'a/b' })).ok
    ).toBe(false)
    expect(db.store.has('waLinks/a/b')).toBe(false)
  })
})

describe('removeOrgNumber', () => {
  it('deletes this organisation’s link and does not touch another’s', async () => {
    const db = seed({
      'waLinks/919000000001': { uid: 'u1', orgId: 'orgA' },
      'waLinks/441234567890': { uid: 'outsider', orgId: 'orgB' },
    })
    expect((await removeOrgNumber(db, { user: admin, phone: '919000000001' })).ok).toBe(true)
    expect(db.store.has('waLinks/919000000001')).toBe(false)
    expect((await removeOrgNumber(db, { user: admin, phone: '441234567890' })).code).toBe(
      'not-found'
    )
    expect(db.store.has('waLinks/441234567890')).toBe(true)
  })
})

describe('prepareOrgTest', () => {
  it('prepares a send only for a linked number, and the body carries no token', async () => {
    const db = seed({
      'waLinks/919000000001': { uid: 'u1', orgId: 'orgA', last4: '0001' },
      'waOrgSettings/orgA': { enabled: false },
    })
    const out = await prepareOrgTest(db, { user: admin, phone: '919000000001', now: new Date(0) })
    expect(out.ok).toBe(true)
    expect(out.waId).toBe('919000000001')
    expect(out.text).toContain('Acme Fitness')
    expect(out.text).toContain('switched off')
    expect(out.text).not.toMatch(/token|secret/i)
    expect((await prepareOrgTest(db, { user: admin, phone: '441234567890' })).code).toBe(
      'not-found'
    )
  })

  it('stops after five tests in the hour', async () => {
    const db = seed({ 'waLinks/919000000001': { uid: 'u1', orgId: 'orgA' } })
    const now = new Date('2026-10-22T12:00:00Z')
    for (let i = 0; i < 5; i += 1) {
      expect((await prepareOrgTest(db, { user: admin, phone: '919000000001', now })).ok).toBe(true)
    }
    expect((await prepareOrgTest(db, { user: admin, phone: '919000000001', now })).code).toBe(
      'resource-exhausted'
    )
  })

  it('refuses when the global outbound cap is already spent', async () => {
    const db = seed({
      'waLinks/919000000001': { uid: 'u1', orgId: 'orgA' },
      'waRate/outbound-global': { day: '2026-10-22', count: 1, alerted: false },
    })
    const out = await prepareOrgTest(db, {
      user: admin,
      phone: '919000000001',
      now: new Date('2026-10-22T08:00:00Z'),
      dailyCap: 1,
    })
    expect(out.code).toBe('resource-exhausted')
  })
})
