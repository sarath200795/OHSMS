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

// ── addDaysISO / toISODate / isOverdueDate ───────────────────────────────────
//
// These replace `setDate` + `toISOString` and `new Date(dueDate) < new Date()`,
// which disagree with the user's calendar east and west of Greenwich
// respectively. The bug they close is not exotic: an action due today wearing a
// red Overdue badge from 05:30 in IST, and a Major NC given six days instead of
// seven.
import { addDaysISO, toISODate, isOverdueDate } from './dates'

describe('addDaysISO', () => {
  it('adds days in the local calendar', () => {
    expect(addDaysISO(7, new Date(2026, 8, 4, 9, 0))).toBe('2026-09-11')
  })

  it('crosses a month end', () => {
    expect(addDaysISO(1, new Date(2026, 8, 30, 9, 0))).toBe('2026-10-01')
  })

  it('crosses a year end', () => {
    expect(addDaysISO(1, new Date(2026, 11, 31, 9, 0))).toBe('2027-01-01')
  })

  it('handles a leap day', () => {
    expect(addDaysISO(1, new Date(2028, 1, 28, 9, 0))).toBe('2028-02-29')
  })

  it('does NOT slip a day just before midnight', () => {
    // The whole point. In UTC+5:30, 23:30 local is 18:00 UTC the same day, and
    // toISOString would have been right here — it is the OTHER end that broke.
    expect(addDaysISO(7, new Date(2026, 8, 4, 23, 30))).toBe('2026-09-11')
  })

  it('does NOT slip a day just after midnight', () => {
    // 00:30 local in UTC+5:30 is 19:00 UTC on the PREVIOUS day, which is where
    // toISOString handed back yesterday and a seven-day action got six.
    expect(addDaysISO(7, new Date(2026, 8, 4, 0, 30))).toBe('2026-09-11')
  })

  it('treats no days as today', () => {
    expect(addDaysISO(0, new Date(2026, 8, 4, 9, 0))).toBe('2026-09-04')
    expect(addDaysISO(undefined, new Date(2026, 8, 4, 9, 0))).toBe('2026-09-04')
  })

  it('goes backwards for a negative count', () => {
    expect(addDaysISO(-1, new Date(2026, 8, 1, 9, 0))).toBe('2026-08-31')
  })
})

describe('toISODate', () => {
  it('takes a date-only string at its word rather than parsing it', () => {
    // new Date('2026-09-30') is UTC midnight, which is the 29th west of
    // Greenwich. The string already says which day it means.
    expect(toISODate('2026-09-30')).toBe('2026-09-30')
  })

  it('reads the local calendar day out of a full ISO instant', () => {
    expect(toISODate('2026-09-30T14:00:00.000Z')).toBe('2026-09-30')
  })

  it('reads a Date', () => {
    expect(toISODate(new Date(2026, 8, 4, 9, 0))).toBe('2026-09-04')
  })

  it('reads a Firestore Timestamp', () => {
    expect(toISODate({ toDate: () => new Date(2026, 8, 4, 9, 0) })).toBe('2026-09-04')
  })

  it('returns empty for a CORRUPT Timestamp instead of "Invalid Date"', () => {
    // The audit module's toDate() guarded only the string branch, so this case
    // reached the screen as the literal text "Invalid Date" and made isOverdue
    // compare NaN — false for every operator, so an overdue CAPA read as on time.
    expect(toISODate({ toDate: () => new Date('nonsense') })).toBe('')
    expect(toISODate({ toDate: () => { throw new Error('boom') } })).toBe('')
  })

  it('returns empty for nonsense and for nothing', () => {
    expect(toISODate('not a date')).toBe('')
    expect(toISODate('')).toBe('')
    expect(toISODate(null)).toBe('')
    expect(toISODate(undefined)).toBe('')
  })
})

describe('isOverdueDate', () => {
  const today = '2026-09-04'

  it('is false for an action due TODAY', () => {
    // The defect, precisely: `new Date('2026-09-04') < new Date()` is true from
    // 05:30 in IST, so a badge went red on the day the work was still due.
    expect(isOverdueDate('2026-09-04', { today })).toBe(false)
  })

  it('is true for yesterday', () => {
    expect(isOverdueDate('2026-09-03', { today })).toBe(true)
  })

  it('is false for tomorrow', () => {
    expect(isOverdueDate('2026-09-05', { today })).toBe(false)
  })

  it('is false once the item is closed, however late it was', () => {
    expect(isOverdueDate('2020-01-01', { closed: true, today })).toBe(false)
  })

  it('is false when there is no due date — that is a different complaint', () => {
    expect(isOverdueDate('', { today })).toBe(false)
    expect(isOverdueDate(null, { today })).toBe(false)
  })

  it('is false for a corrupt value rather than guessing', () => {
    expect(isOverdueDate({ toDate: () => new Date('nonsense') }, { today })).toBe(false)
  })

  it('works on a Timestamp as well as a string', () => {
    expect(isOverdueDate({ toDate: () => new Date(2026, 8, 3) }, { today })).toBe(true)
  })
})
