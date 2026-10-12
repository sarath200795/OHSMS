import { describe, it, expect } from 'vitest'
import { istDay, dayOf, summariseSites, appResolveSite } from './siteSummary.js'
import { packCounts, unpackCounts } from './whatsapp/store.js'

// The cross-package parity test lives at src/pages/admin/siteSummary.parity.test.js;
// these cover what only the server has: the IST calendar and the packed snapshot.
describe('IST calendar days', () => {
  it('takes today from Asia/Kolkata, not the runtime clock', () => {
    expect(istDay(new Date('2026-10-11T18:29:00Z'))).toBe('2026-10-11')
    expect(istDay(new Date('2026-10-11T18:31:00Z'))).toBe('2026-10-12')
  })
  it('reads dates in every stored shape', () => {
    expect(dayOf('2026-10-12')).toBe('2026-10-12')
    expect(dayOf('2026-10-12T23:00:00')).toBe('2026-10-12')
    expect(dayOf(new Date('2026-10-11T20:00:00Z'))).toBe('2026-10-12')
    expect(dayOf({ toDate: () => new Date('2026-10-11T20:00:00Z') })).toBe('2026-10-12')
    expect(
      dayOf({
        toDate: () => {
          throw new Error('corrupt')
        },
      })
    ).toBeNull()
    expect(dayOf('not a date')).toBeNull()
    expect(dayOf('')).toBeNull()
  })
})

describe('summariseSites', () => {
  it('counts HPT due on the IST day, so 00:30 IST is already the next day', () => {
    const data = {
      sites: [{ id: 's1', name: 'A' }],
      extinguishers: [{ id: 'e', siteId: 's1', status: 'active', dateOfNextHPT: '2026-10-12' }],
    }
    expect(summariseSites(data, { now: new Date('2026-10-11T18:00:00Z') }).s1.hptOverdue).toBe(0)
    expect(summariseSites(data, { now: new Date('2026-10-11T19:00:00Z') }).s1.hptOverdue).toBe(1)
  })
  it('leaves out an action source whose module is switched off', () => {
    const data = {
      sites: [{ id: 's1', name: 'A' }],
      incidents: [{ id: 'i', siteId: 's1', capa: [{ id: 'c', status: 'open' }] }],
    }
    expect(summariseSites(data).s1.pendingActions).toBe(1)
    expect(summariseSites(data, { modules: { incidents: false } }).s1.pendingActions).toBe(0)
  })
  it('does not take an override for a centre named after an Object.prototype key', () => {
    expect(appResolveSite('constructor', [{ id: 's', name: 'X' }])).toBeNull()
  })
})

describe('packed snapshot rows', () => {
  it('round-trip', () => {
    const c = {
      extinguishers: 6,
      hptOverdue: 1,
      openDefects: 3,
      defectsByKind: { extinguisher: 2, aed: 1, fas: 0 },
      firstAidBoxes: 2,
      pendingActions: 4,
      overdueActions: 1,
      incidentsTotal: 7,
      incidentsOpen: 1,
      incidents90d: 2,
    }
    expect(unpackCounts(packCounts(c))).toEqual(c)
  })
})
