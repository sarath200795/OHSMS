import { describe, it, expect } from 'vitest'
import { memoryDb } from '../../test-support/memoryDb.js'
import { createStore } from './store.js'

const LINK = { uid: 'u1', orgId: 'orgA' }

describe('orgLookupEnabled on the store', () => {
  it('stays on when the switch document is missing, and off only when enabled is false', async () => {
    const db = memoryDb({ 'waOrgSettings/orgA': { enabled: false } })
    const store = createStore(db, { pepper: 'pepper' })
    expect(await store.orgLookupEnabled('orgA')).toBe(false)
    expect(await store.orgLookupEnabled('orgB')).toBe(true)
    expect(await store.orgLookupEnabled('a/b')).toBe(false)
    expect(await store.orgLookupEnabled('')).toBe(false)
  })
})

describe('getSiteAuditCache', () => {
  const at = new Date('2026-10-25T03:54:00.000Z')

  it('reads the stored extract and refuses a path that is not one segment', async () => {
    const db = memoryDb({
      'organizations/orgA/siteAuditCache/s1': {
        none: false,
        syncedAt: at,
        date: '2026-03-02',
        scoreOnDay: 82,
        scoreAfter7: null,
        findingsKnown: true,
        openPoints: ['Fire: Exit route blocked'],
        openTotal: 1,
        openMore: 0,
        windowDays: 120,
      },
    })
    const store = createStore(db, { pepper: 'pepper' })
    const row = await store.getSiteAuditCache('orgA', 's1')
    expect(row).toMatchObject({ none: false, date: '2026-03-02', scoreOnDay: 82 })
    expect(row.syncedAt).toEqual(at)
    expect(await store.getSiteAuditCache('orgA', 'missing')).toBeNull()
    expect(await store.getSiteAuditCache('orgA/other', 's1')).toBeNull()
    expect(await store.getSiteAuditCache('orgA', 's1/extra')).toBeNull()
  })
})

describe('getLink spelling', () => {
  it('finds a row stored with a plus, without the country code, or with a trunk zero', async () => {
    const db = memoryDb({
      'waLinks/+917700000001': LINK,
      'waLinks/7700000002': LINK,
      'waLinks/07700000003': { uid: 'u3', orgId: 'orgA' },
      'waLinks/9107700000004': { uid: 'u4', orgId: 'orgA' },
    })
    const store = createStore(db, { pepper: 'pepper' })
    expect(await store.getLink('917700000001')).toEqual(LINK)
    expect(await store.getLink('917700000002')).toEqual(LINK)
    expect(await store.getLink('917700000003')).toEqual({ uid: 'u3', orgId: 'orgA' })
    expect(await store.getLink('917700000004')).toEqual({ uid: 'u4', orgId: 'orgA' })
    expect(await store.getLink('441234567890')).toBeNull()
  })

  it('prefers the canonical row over an older spelling', async () => {
    const db = memoryDb({
      'waLinks/+917700000001': { uid: 'old', orgId: 'orgA' },
      'waLinks/917700000001': { uid: 'new', orgId: 'orgA' },
    })
    const store = createStore(db, { pepper: 'pepper' })
    expect(await store.getLink('917700000001')).toEqual({ uid: 'new', orgId: 'orgA' })
  })

  it('unlink removes every spelling of the handset', async () => {
    const db = memoryDb({
      'waLinks/+917700000001': LINK,
      'waLinks/7700000001': LINK,
      'waLinks/441234567890': { uid: 'other', orgId: 'orgB' },
    })
    const store = createStore(db, { pepper: 'pepper' })
    await store.unlink('917700000001')
    expect(db.store.has('waLinks/+917700000001')).toBe(false)
    expect(db.store.has('waLinks/7700000001')).toBe(false)
    expect(db.store.has('waLinks/441234567890')).toBe(true)
    expect(await store.getLink('917700000001')).toBeNull()
  })
})
