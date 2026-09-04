import { describe, it, expect } from 'vitest'
import {
  firstAidCell,
  isItemAvailable,
  firstAidSummary,
  requiredQty,
  itemExpires,
  isExpired,
  isExpiringSoon,
} from './firstAidLogic'
import { FIRST_AID_ITEM_NAMES } from './constants'

const TODAY = new Date('2026-06-01T00:00:00Z')
const iso = (d) => new Date(d).toISOString().slice(0, 10)
const inDays = (n) => iso(TODAY.getTime() + n * 86400000)

// "Scissors" needs one and never expires; "ORS Sachets" needs four and does.
const SIMPLE = 'Scissors'
const DATED = 'ORS Sachets'

const rec = (over = {}) => ({ centerName: 'A', item: SIMPLE, quantity: 1, condition: 'Available', ...over })

describe('item definitions', () => {
  it('knows each item’s required quantity and whether it has a shelf life', () => {
    expect(requiredQty(SIMPLE)).toBe(1)
    expect(requiredQty(DATED)).toBe(4)
    expect(itemExpires(SIMPLE)).toBe(false)
    expect(itemExpires(DATED)).toBe(true)
  })

  // An item nobody has defined still has to be scoreable, or one stale record
  // takes the whole matrix row down with it.
  it('falls back to a requirement of one for an unknown item', () => {
    expect(requiredQty('Something nobody listed')).toBe(1)
    expect(itemExpires('Something nobody listed')).toBe(false)
  })
})

describe('expiry', () => {
  it('reads expiry from the date and from the condition alike', () => {
    expect(isExpired(rec({ expiryDate: inDays(-1) }), TODAY)).toBe(true)
    expect(isExpired(rec({ condition: 'Expired' }), TODAY)).toBe(true)
    expect(isExpired(rec({ expiryDate: inDays(90) }), TODAY)).toBe(false)
  })

  // A surveyor can record 'Expired' without reading the printed date, and a
  // record left alone goes out of date on its own. Only one of those two facts
  // being honoured would let half the expired stock read as usable.
  it('does not call an already-expired record "expiring soon"', () => {
    expect(isExpiringSoon(rec({ expiryDate: inDays(10) }), TODAY)).toBe(true)
    expect(isExpiringSoon(rec({ expiryDate: inDays(-10) }), TODAY)).toBe(false)
    expect(isExpiringSoon(rec({ expiryDate: inDays(90) }), TODAY)).toBe(false)
  })
})

describe('firstAidCell', () => {
  it('is "none" with no records and "ok" with a full one', () => {
    expect(firstAidCell([], SIMPLE, TODAY)).toMatchObject({ count: 0, status: 'none', qty: 0 })
    expect(firstAidCell([rec()], SIMPLE, TODAY)).toMatchObject({ status: 'ok', label: '1/1' })
  })

  it('sums every box at the site against the site-wide minimum', () => {
    const recs = [
      rec({ item: DATED, quantity: 2, boxLocation: 'Reception' }),
      rec({ item: DATED, quantity: 2, boxLocation: 'Gym floor' }),
    ]
    expect(firstAidCell(recs, DATED, TODAY)).toMatchObject({ status: 'ok', qty: 4, label: '4/4' })
  })

  it('flags short stock as an issue rather than a gap in the count', () => {
    expect(firstAidCell([rec({ item: DATED, quantity: 2 })], DATED, TODAY))
      .toMatchObject({ status: 'issue', qty: 2, label: '2/4' })
  })

  it('flags damaged and low-stock conditions even at full count', () => {
    expect(firstAidCell([rec({ condition: 'Damaged' })], SIMPLE, TODAY).status).toBe('issue')
    expect(firstAidCell([rec({ condition: 'Low Stock' })], SIMPLE, TODAY).status).toBe('issue')
  })

  // The failure this register exists to catch: a box that looks full of stock
  // nobody may use. A plain count reads it as compliance.
  it('does not count expired stock toward the quantity held', () => {
    const expiredOnly = [rec({ item: DATED, quantity: 8, expiryDate: inDays(-1) })]
    expect(firstAidCell(expiredOnly, DATED, TODAY)).toMatchObject({ status: 'missing', qty: 0, expired: 1 })
  })

  it('flags a site that has enough in date but expired stock beside it', () => {
    const mixed = [
      rec({ item: DATED, quantity: 4, expiryDate: inDays(200) }),
      rec({ item: DATED, quantity: 4, expiryDate: inDays(-5) }),
    ]
    expect(firstAidCell(mixed, DATED, TODAY)).toMatchObject({ status: 'issue', qty: 4, expired: 1 })
  })

  it('flags stock that is about to go out of date', () => {
    expect(firstAidCell([rec({ item: DATED, quantity: 4, expiryDate: inDays(10) })], DATED, TODAY).status).toBe('issue')
    expect(firstAidCell([rec({ item: DATED, quantity: 4, expiryDate: inDays(200) })], DATED, TODAY).status).toBe('ok')
  })

  it('treats a record of "Missing" and a recorded zero as the same answer', () => {
    expect(firstAidCell([rec({ condition: 'Missing', quantity: 3 })], SIMPLE, TODAY).status).toBe('missing')
    expect(firstAidCell([rec({ quantity: 0 })], SIMPLE, TODAY).status).toBe('missing')
  })
})

describe('isItemAvailable', () => {
  // Deliberately stricter than signage, where a faded-but-present sign counts
  // as covered. Every item here is scored against a required count, which makes
  // it the analogue of the one signage column that has never accepted a partial
  // match either — two of twenty bandages is not a stocked box.
  it('accepts only a full, in-date count', () => {
    expect(isItemAvailable({ status: 'ok' })).toBe(true)
    expect(isItemAvailable({ status: 'issue' })).toBe(false)
    expect(isItemAvailable({ status: 'missing' })).toBe(false)
    expect(isItemAvailable({ status: 'none' })).toBe(false)
  })

  // The matrix and the dashboard read a cell through firstAidCell and then
  // isItemAvailable, so the two must never disagree about what they saw.
  it('agrees with firstAidCell on every status it produces', () => {
    const cases = [
      [[], SIMPLE],
      [[rec()], SIMPLE],
      [[rec({ condition: 'Damaged' })], SIMPLE],
      [[rec({ condition: 'Missing' })], SIMPLE],
      [[rec({ item: DATED, quantity: 2 })], DATED],
      [[rec({ item: DATED, quantity: 4, expiryDate: inDays(-1) })], DATED],
    ]
    for (const [recs, item] of cases) {
      const cell = firstAidCell(recs, item, TODAY)
      expect(['ok', 'issue', 'missing', 'none']).toContain(cell.status)
      expect(isItemAvailable(cell)).toBe(cell.status === 'ok')
    }
  })
})

describe('firstAidSummary', () => {
  const items = [SIMPLE, DATED]

  it('scores a site per item and rolls the cells up', () => {
    const s = firstAidSummary(
      ['A'],
      [rec({ item: SIMPLE, quantity: 1 }), rec({ item: DATED, quantity: 2 })],
      items, {}, TODAY
    )
    expect(s.sites).toBe(1)
    expect(s.cells).toBe(2)
    expect(s.available).toBe(1)
    expect(s.ok).toBe(1)
    expect(s.issue).toBe(1)
    expect(s.readiness).toBe(50)
    expect(s.sitesWithGaps).toBe(1)
    expect(s.fullyStocked).toBe(0)
  })

  // A site nobody has checked has to stay in the denominator. Dropping it would
  // report the estate's readiness as the readiness of the sites somebody
  // happened to visit — which rises every time a site is ignored.
  it('keeps an unchecked site at zero rather than dropping it', () => {
    const s = firstAidSummary(['A', 'B'], [rec({ item: SIMPLE }), rec({ item: DATED, quantity: 4 })], items, {}, TODAY)
    expect(s.sites).toBe(2)
    expect(s.cells).toBe(4)
    expect(s.notRecorded).toBe(2)
    expect(s.readiness).toBe(50)
    expect(s.bySite.find((r) => r.site === 'B')).toMatchObject({ readiness: 0, gaps: 2, records: 0 })
  })

  it('ignores records for sites outside the scope it was given', () => {
    const s = firstAidSummary(['A'], [rec(), rec({ centerName: 'Elsewhere' })], items, {}, TODAY)
    expect(s.records).toBe(1)
  })

  it('counts expired and expiring stock separately from the cell scores', () => {
    const s = firstAidSummary(
      ['A'],
      [
        rec({ item: DATED, quantity: 4, expiryDate: inDays(-1) }),
        rec({ item: DATED, quantity: 4, expiryDate: inDays(10) }),
      ],
      items, {}, TODAY
    )
    expect(s.expired).toBe(1)
    expect(s.expiringSoon).toBe(1)
    expect(s.bySite[0].expired).toBe(1)
  })

  it('counts the distinct boxes named at each site', () => {
    const s = firstAidSummary(
      ['A'],
      [
        rec({ boxLocation: 'Reception' }),
        rec({ item: DATED, quantity: 4, boxLocation: 'Reception' }),
        rec({ item: DATED, quantity: 4, boxLocation: 'Gym floor' }),
      ],
      items, {}, TODAY
    )
    expect(s.boxes).toBe(2)
    expect(s.bySite[0].boxes).toBe(2)
  })

  it('uses the region and entity maps the caller already built', () => {
    const s = firstAidSummary(['A'], [rec()], items, { regionOf: { A: 'South' }, entityOf: { A: 'COCO' } }, TODAY)
    expect(s.bySite[0]).toMatchObject({ region: 'South', entity: 'COCO' })
  })

  it('orders the weakest item and the worst site first', () => {
    const s = firstAidSummary(
      ['A', 'B'],
      [
        rec({ centerName: 'A', item: SIMPLE }), rec({ centerName: 'A', item: DATED, quantity: 4 }),
        rec({ centerName: 'B', item: SIMPLE }),
      ],
      items, {}, TODAY
    )
    expect(s.byItem[0].item).toBe(DATED)
    expect(s.bySite[0].site).toBe('B')
  })

  it('defaults to the full contents list', () => {
    const s = firstAidSummary(['A'], [], undefined, {}, TODAY)
    expect(s.items).toBe(FIRST_AID_ITEM_NAMES.length)
    expect(s.readiness).toBe(0)
  })

  it('survives an empty scope without dividing by zero', () => {
    expect(firstAidSummary([], [], items, {}, TODAY)).toMatchObject({ sites: 0, cells: 0, readiness: 0 })
  })
})
