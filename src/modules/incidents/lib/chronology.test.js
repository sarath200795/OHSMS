import { describe, it, expect } from 'vitest'
import {
  incidentChronology, sortChronology, chronologyMoment, formatChronologyMoment,
  meaningfulChronology, chronologySpan, blankChronologyEntry,
} from './chronology'

const row = (over = {}) => ({ id: 'r', date: '2026-03-14', time: '09:00', event: 'Something', source: '', ...over })

describe('incidentChronology', () => {
  it('gives an empty array for every incident raised before the field existed', () => {
    // The whole register predates this field. A report that cannot be printed
    // for an old incident is a report that fails exactly when it is needed.
    expect(incidentChronology(undefined)).toEqual([])
    expect(incidentChronology({})).toEqual([])
    expect(incidentChronology({ chronology: null })).toEqual([])
  })

  it('coerces every field to a string, so a report never renders [object Object]', () => {
    const out = incidentChronology({ chronology: [{ id: 7, date: 20260314, event: { x: 1 } }] })
    expect(out[0].id).toBe('7')
    expect(typeof out[0].date).toBe('string')
    expect(typeof out[0].event).toBe('string')
    expect(out[0].time).toBe('')
  })

  it('drops entries that are not objects rather than letting them reach a renderer', () => {
    expect(incidentChronology({ chronology: [null, 'nope', row()] })).toHaveLength(1)
  })

  it('gives every row an id, because the editor keys its inputs on one', () => {
    const out = incidentChronology({ chronology: [{ event: 'a' }, { event: 'b' }] })
    expect(new Set(out.map((r) => r.id)).size).toBe(2)
  })
})

describe('chronologyMoment', () => {
  it('is empty for an undated row, which is what sorts it last', () => {
    expect(chronologyMoment({ time: '09:00' })).toBe('')
  })

  it('puts a dated row with no time at the start of its day', () => {
    expect(chronologyMoment({ date: '2026-03-14' })).toBe('2026-03-14T00:00')
  })

  it('pads a single-digit hour, or 9:05 would sort after 10:05', () => {
    expect(chronologyMoment({ date: '2026-03-14', time: '9:05' })).toBe('2026-03-14T09:05')
    expect(chronologyMoment({ date: '2026-03-14', time: '9:05' }) < chronologyMoment({ date: '2026-03-14', time: '10:05' })).toBe(true)
  })

  it('ignores a time that is not a time', () => {
    expect(chronologyMoment({ date: '2026-03-14', time: 'morning' })).toBe('2026-03-14T00:00')
  })
})

describe('sortChronology', () => {
  it('orders by moment across days as well as within one', () => {
    const rows = [
      row({ id: 'c', date: '2026-03-15', time: '08:00' }),
      row({ id: 'a', date: '2026-03-14', time: '06:40' }),
      row({ id: 'b', date: '2026-03-14', time: '09:12' }),
    ]
    expect(sortChronology(rows).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('keeps undated rows, last, in the order they were entered', () => {
    // "We never established when the alarm was silenced" is a finding. Dropping
    // the row deletes the gap it records.
    const rows = [row({ id: 'x', date: '', time: '' }), row({ id: 'y', date: '2026-03-14', time: '07:00' }), row({ id: 'z', date: '', time: '' })]
    expect(sortChronology(rows).map((r) => r.id)).toEqual(['y', 'x', 'z'])
  })

  it('is stable for two rows at the same moment', () => {
    const rows = [row({ id: 'first' }), row({ id: 'second' })]
    expect(sortChronology(rows).map((r) => r.id)).toEqual(['first', 'second'])
  })

  it('does not mutate the array it was given — the editor holds that array as state', () => {
    const rows = [row({ id: 'b', time: '10:00' }), row({ id: 'a', time: '08:00' })]
    sortChronology(rows)
    expect(rows.map((r) => r.id)).toEqual(['b', 'a'])
  })
})

describe('formatChronologyMoment', () => {
  it('prints the date the reader meant, not the one UTC parsing would give', () => {
    // 'YYYY-MM-DD' through new Date() is UTC midnight and prints as the previous
    // day west of Greenwich. On an incident record that is a factual error.
    expect(formatChronologyMoment({ date: '2026-03-14', time: '09:12' })).toBe('14 Mar 2026 · 09:12')
  })

  it('says so plainly when a moment was never established', () => {
    expect(formatChronologyMoment({})).toBe('Time not established')
    expect(formatChronologyMoment({ time: '09:12' })).toBe('Date not established · 09:12')
  })
})

describe('meaningfulChronology', () => {
  it('drops the empty row the editor always keeps at the bottom', () => {
    expect(meaningfulChronology([row(), blankChronologyEntry({ incidentDate: '2026-03-14' })])).toHaveLength(1)
  })

  it('treats whitespace as empty', () => {
    expect(meaningfulChronology([row({ event: '   ' })])).toHaveLength(0)
  })
})

describe('chronologySpan', () => {
  it('is empty until two rows carry a moment — one event spans nothing', () => {
    expect(chronologySpan([row()])).toBe('')
    expect(chronologySpan([row({ date: '' }), row({ date: '' })])).toBe('')
  })

  it('reads in minutes for a short sequence, which is what most of them are', () => {
    expect(chronologySpan([row({ time: '09:00' }), row({ time: '09:11' })])).toBe('11 minutes')
  })

  it('rolls up to hours and days', () => {
    expect(chronologySpan([row({ time: '06:00' }), row({ time: '09:30' })])).toBe('3h 30m')
    expect(chronologySpan([row({ date: '2026-03-14', time: '06:00' }), row({ date: '2026-03-16', time: '06:00' })])).toBe('2 days')
  })
})

describe('blankChronologyEntry', () => {
  it('dates itself to the incident, so the common case needs no typing', () => {
    expect(blankChronologyEntry({ incidentDate: '2026-03-14' }).date).toBe('2026-03-14')
  })

  it('survives an incident with no date at all', () => {
    expect(blankChronologyEntry().date).toBe('')
  })
})
