import { describe, it, expect } from 'vitest'
import { todayISO, isFutureDate } from './dates'

describe('todayISO', () => {
  it('formats the LOCAL calendar date, not the UTC one', () => {
    // 23:30 on the 15th in a UTC+5:30 timezone is still the 15th to the person
    // typing it, and 18:00 UTC — so toISOString() would have said the 15th here
    // only by luck. Construct the date from local parts to pin the intent.
    const d = new Date(2026, 5, 15, 23, 30)
    expect(todayISO(d)).toBe('2026-06-15')
  })

  it('zero-pads, so the strings sort chronologically', () => {
    expect(todayISO(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('isFutureDate', () => {
  const TODAY = '2026-06-15'

  it('is true only for a date after today', () => {
    expect(isFutureDate('2026-06-16', TODAY)).toBe(true)
    expect(isFutureDate('2027-01-01', TODAY)).toBe(true)
  })

  it('treats today itself as allowed', () => {
    expect(isFutureDate(TODAY, TODAY)).toBe(false)
  })

  it('is false for the past', () => {
    expect(isFutureDate('2026-06-14', TODAY)).toBe(false)
    expect(isFutureDate('1999-12-31', TODAY)).toBe(false)
  })

  // The required-field check owns the empty case; this one must not also claim
  // it, or the user is told their blank field is in the future.
  it('says nothing about an empty or malformed value', () => {
    expect(isFutureDate('', TODAY)).toBe(false)
    expect(isFutureDate(null, TODAY)).toBe(false)
    expect(isFutureDate(undefined, TODAY)).toBe(false)
  })

  it('compares across year and month boundaries', () => {
    expect(isFutureDate('2026-07-01', '2026-06-30')).toBe(true)
    expect(isFutureDate('2026-06-30', '2026-07-01')).toBe(false)
    expect(isFutureDate('2027-01-01', '2026-12-31')).toBe(true)
  })
})
