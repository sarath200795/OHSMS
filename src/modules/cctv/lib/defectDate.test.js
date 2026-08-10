import { describe, it, expect } from 'vitest'
import { asReportedOn, todayISO, nextReportedOn } from './defectDate'

// A fixed clock, so these assertions mean the same thing in every timezone and
// on every day of the year.
const AT = new Date(2026, 6, 30, 9, 15) // 30 July 2026, local time

describe('asReportedOn', () => {
  it('keeps a plain date', () => {
    expect(asReportedOn('2026-03-04')).toBe('2026-03-04')
    expect(asReportedOn('  2026-03-04  ')).toBe('2026-03-04')
  })

  it('drops anything that is not one, rather than storing a half-date', () => {
    expect(asReportedOn('')).toBe('')
    expect(asReportedOn('2026-03')).toBe('')
    expect(asReportedOn('04/03/2026')).toBe('')
    expect(asReportedOn(undefined)).toBe('')
    expect(asReportedOn(null)).toBe('')
  })
})

describe('todayISO', () => {
  it('reads the local day, not the UTC one', () => {
    // 23:30 local on the 30th is already the 31st in UTC east of Greenwich; the
    // person filling the form is still having the 30th.
    expect(todayISO(new Date(2026, 6, 30, 23, 30))).toBe('2026-07-30')
    expect(todayISO(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01')
  })
})

describe('nextReportedOn', () => {
  it('dates the first defect raised on a clean device', () => {
    expect(nextReportedOn({ before: [], after: ['blur'], current: '', today: AT })).toBe('2026-07-30')
  })

  it('blanks the date when the last defect is cleared', () => {
    expect(nextReportedOn({ before: ['blur'], after: [], current: '2026-01-04', today: AT })).toBe('')
  })

  it('does not re-date a device when a second defect is added', () => {
    expect(
      nextReportedOn({ before: ['blur'], after: ['blur', 'blocked'], current: '2026-01-04', today: AT })
    ).toBe('2026-01-04')
  })

  it('leaves an already-defective record undated rather than inventing a date', () => {
    // Everything raised before this field existed is in this state. Today's
    // date would be a fabrication, and once stored it would be unrecognisable
    // as one.
    expect(nextReportedOn({ before: ['blur'], after: ['blur', 'angle'], current: '', today: AT })).toBe('')
  })

  it('keeps a date a person typed by hand', () => {
    // Defects are often entered days after the walk-round that found them.
    expect(
      nextReportedOn({ before: ['blur'], after: ['blur', 'blocked'], current: '2026-07-21', today: AT })
    ).toBe('2026-07-21')
  })

  it('refuses a corrupted hand-entered value instead of passing it through', () => {
    expect(nextReportedOn({ before: ['blur'], after: ['blur'], current: '21-07-2026', today: AT })).toBe('')
  })

  it('survives being called with nothing', () => {
    expect(nextReportedOn()).toBe('')
  })
})
