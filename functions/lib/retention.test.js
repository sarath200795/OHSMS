import { describe, it, expect } from 'vitest'
import {
  PURGE_AFTER_DAYS, MAX_PURGES_PER_RUN, PURGEABLE,
  toMillis, isExpired, daysRemaining, planPurge,
} from './retention.js'

const NOW = Date.parse('2026-08-14T00:00:00.000Z')
const daysAgo = (n) => NOW - n * 24 * 60 * 60 * 1000

describe('reading a deletedAt, whatever shape it arrived in', () => {
  it('handles a Firestore Timestamp, a Date, an ISO string and epoch millis', () => {
    expect(toMillis({ toMillis: () => 123 })).toBe(123)
    expect(toMillis({ seconds: 1, nanoseconds: 0 })).toBe(1000)
    expect(toMillis(new Date(NOW))).toBe(NOW)
    expect(toMillis('2026-08-14T00:00:00.000Z')).toBe(NOW)
    expect(toMillis(NOW)).toBe(NOW)
  })

  it('returns nothing for what it cannot read', () => {
    expect(toMillis(null)).toBeNull()
    expect(toMillis(undefined)).toBeNull()
    expect(toMillis('not a date')).toBeNull()
    expect(toMillis({})).toBeNull()
  })
})

describe('when a record is past its window', () => {
  it('expires on the 30th day, not the 31st', () => {
    expect(isExpired(daysAgo(30), NOW)).toBe(true)
    expect(isExpired(daysAgo(29), NOW)).toBe(false)
    expect(isExpired(daysAgo(100), NOW)).toBe(true)
  })

  // The safe answer to "we do not know when this was deleted" is to leave it
  // alone: keeping a record too long is a finding, destroying a live one is the
  // record.
  it('never expires a record whose timestamp it cannot read', () => {
    expect(isExpired(null, NOW)).toBe(false)
    expect(isExpired(undefined, NOW)).toBe(false)
    expect(isExpired('nonsense', NOW)).toBe(false)
  })

  it('counts the days the UI counts down', () => {
    expect(daysRemaining(daysAgo(0), NOW)).toBe(30)
    expect(daysRemaining(daysAgo(29), NOW)).toBe(1)
    expect(daysRemaining(daysAgo(30), NOW)).toBe(0)
    expect(daysRemaining(daysAgo(45), NOW)).toBe(0)
    expect(daysRemaining(null, NOW)).toBeNull()
  })

  it('honours a different window when one is asked for', () => {
    expect(isExpired(daysAgo(10), NOW, 7)).toBe(true)
    expect(isExpired(daysAgo(10), NOW, 90)).toBe(false)
  })
})

describe('planning what a run may destroy', () => {
  const doc = (id, deletedAt) => ({ id, deletedAt })

  it('takes the expired and leaves the rest, saying why', () => {
    const { purge, keep } = planPurge(
      [doc('old', daysAgo(40)), doc('fresh', daysAgo(2)), doc('live', null)],
      { now: NOW },
    )
    expect(purge).toEqual(['old'])
    expect(keep).toEqual([
      { id: 'fresh', reason: '28 days left' },
      { id: 'live', reason: 'not deleted' },
    ])
  })

  // The check that must not depend on the query being right. A query is a
  // filter; this is the guarantee.
  it('never destroys a record that is not in the bin, whatever it was handed', () => {
    const { purge } = planPurge([doc('live', null), doc('alsoLive', undefined)], { now: NOW })
    expect(purge).toEqual([])
  })

  // A scheduled hard delete is irreversible, unattended, and spans every
  // tenant. The cap means a mistake in the query costs one run, not the
  // database — and shows up in the logs while there is still something left.
  it('stops at the per-run cap and says it was capped', () => {
    const many = Array.from({ length: 20 }, (_, i) => doc(`d${i}`, daysAgo(40)))
    const { purge, capped, keep } = planPurge(many, { now: NOW, max: 5 })
    expect(purge).toHaveLength(5)
    expect(capped).toBe(true)
    expect(keep.filter((k) => k.reason === 'over the per-run cap')).toHaveLength(15)
  })

  it('is not capped when everything fits', () => {
    expect(planPurge([doc('a', daysAgo(40))], { now: NOW }).capped).toBe(false)
  })

  it('reports both halves, so a reader can check the query selected what they think', () => {
    const { purge, keep } = planPurge([doc('a', daysAgo(40)), doc('b', daysAgo(1))], { now: NOW })
    expect(purge.length + keep.length).toBe(2)
  })

  it('survives junk in the list', () => {
    expect(planPurge([null, undefined], { now: NOW }).purge).toEqual([])
    expect(planPurge().purge).toEqual([])
  })
})

describe('what has to go with each record', () => {
  it('matches the window the screen has always promised', () => {
    expect(PURGE_AFTER_DAYS).toBe(30)
    expect(MAX_PURGES_PER_RUN).toBeGreaterThan(0)
  })

  // A pointer must not outlive its file, nor a public mirror its asset.
  it('cascades subcollections for the two that carry attachments', () => {
    const by = Object.fromEntries(PURGEABLE.map((p) => [p.collection, p]))
    expect(by.incidents.subcollections).toEqual(['photos'])
    expect(by.illnesses.subcollections).toEqual(['files'])
  })

  it('cascades the public QR mirror for every asset that has one', () => {
    for (const col of ['extinguishers', 'aeds', 'fas', 'signages']) {
      expect(PURGEABLE.find((p) => p.collection === col)?.qrMirror, col).toBe(true)
    }
  })
})
