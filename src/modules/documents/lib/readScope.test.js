import { describe, it, expect } from 'vitest'
import { readPlan, mergeResults, chunk, isElevated, IN_LIMIT, ELEVATED_ROLES } from './readScope'

const sites = (n, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `s${from + i}`, name: `Site ${from + i}` }))

describe('isElevated', () => {
  it('lets admin, manager and auditor past the site check', () => {
    ELEVATED_ROLES.forEach((r) => expect(isElevated(r)).toBe(true))
  })

  it('does not let a member past', () => {
    expect(isElevated('member')).toBe(false)
  })

  // A blank or unknown role must land on the restricted side. Failing open here
  // would hand the whole library to anyone whose profile had not loaded yet.
  it('treats a missing or unrecognised role as restricted', () => {
    expect(isElevated(undefined)).toBe(false)
    expect(isElevated(null)).toBe(false)
    expect(isElevated('')).toBe(false)
    expect(isElevated('Admin')).toBe(false)
    expect(isElevated('superuser')).toBe(false)
  })
})

describe('readPlan', () => {
  it('asks for everything in one query when the viewer is elevated', () => {
    const plan = readPlan('admin', sites(3))
    expect(plan).toHaveLength(1)
    expect(plan[0].field).toBeNull()
  })

  it('always asks for the org-wide documents first', () => {
    expect(readPlan('member', sites(2))[0]).toEqual({
      field: 'visibility',
      op: '==',
      value: 'all',
    })
  })

  it('adds one site query for a member who can reach sites', () => {
    const plan = readPlan('member', sites(3))
    expect(plan).toHaveLength(2)
    expect(plan[1]).toEqual({ field: 'siteId', op: 'in', value: ['s0', 's1', 's2'] })
  })

  // Someone mapped to nothing still gets the org-wide library — that is what
  // the Organization level is for.
  it('still asks for the org-wide documents when the viewer reaches no site', () => {
    const plan = readPlan('member', [])
    expect(plan).toHaveLength(1)
    expect(plan[0].value).toBe('all')
  })

  // Firestore refuses an `in` of more than 30, and a query that throws would
  // empty the library rather than shorten it.
  it('splits site ids into queries Firestore will accept', () => {
    const plan = readPlan('member', sites(71))
    expect(plan).toHaveLength(1 + 3)
    plan.slice(1).forEach((p) => expect(p.value.length).toBeLessThanOrEqual(IN_LIMIT))
    expect(plan.slice(1).flatMap((p) => p.value)).toHaveLength(71)
  })

  it('does not ask for the same site twice', () => {
    const plan = readPlan('member', [{ id: 'a' }, { id: 'a' }, { id: 'b' }])
    expect(plan[1].value).toEqual(['a', 'b'])
  })

  it('ignores sites with no id rather than querying for an empty string', () => {
    const plan = readPlan('member', [{ id: '' }, { id: null }, { id: 'a' }, {}])
    expect(plan[1].value).toEqual(['a'])
  })
})

describe('chunk', () => {
  it('returns nothing for an empty list', () => {
    expect(chunk([])).toEqual([])
  })

  it('does not split a list that already fits', () => {
    expect(chunk([1, 2, 3])).toEqual([[1, 2, 3]])
  })

  it('splits exactly at the boundary', () => {
    expect(chunk(Array.from({ length: 60 }, (_, i) => i))).toHaveLength(2)
    expect(chunk(Array.from({ length: 61 }, (_, i) => i))).toHaveLength(3)
  })
})

describe('mergeResults', () => {
  const ts = (s) => ({ toMillis: () => s * 1000 })

  it('combines the queries into one newest-first list', () => {
    const merged = mergeResults([
      [{ id: 'a', createdAt: ts(10) }],
      [{ id: 'b', createdAt: ts(30) }, { id: 'c', createdAt: ts(20) }],
    ])
    expect(merged.map((r) => r.id)).toEqual(['b', 'c', 'a'])
  })

  // A document could satisfy two queries at once; it must appear once.
  it('deduplicates by id', () => {
    const merged = mergeResults([
      [{ id: 'a', createdAt: ts(10) }],
      [{ id: 'a', createdAt: ts(10) }],
    ])
    expect(merged).toHaveLength(1)
  })

  // A query that has not answered yet is null, not an empty list — the two must
  // not be confused, but neither may throw.
  it('ignores queries that have not answered yet', () => {
    expect(mergeResults([null, [{ id: 'a', createdAt: ts(1) }], undefined])).toHaveLength(1)
    expect(mergeResults([])).toEqual([])
  })

  it('sorts a just-written record with no timestamp last rather than throwing', () => {
    const merged = mergeResults([[{ id: 'a' }, { id: 'b', createdAt: ts(5) }]])
    expect(merged.map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('reads a raw Timestamp shape and an ISO string', () => {
    const merged = mergeResults([
      [{ id: 'a', createdAt: { seconds: 5 } }, { id: 'b', createdAt: '2026-01-01T00:00:00Z' }],
    ])
    expect(merged.map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('drops a row with no id rather than keying the map on undefined', () => {
    expect(mergeResults([[{ createdAt: ts(1) }, { id: 'a', createdAt: ts(2) }]])).toHaveLength(1)
  })
})
