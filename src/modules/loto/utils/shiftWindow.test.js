import { describe, expect, it } from 'vitest'
import { SHIFT_PRESETS } from '../constants/permits'
import {
  openShiftWindow,
  shiftDurationMinutes,
  shiftRequestProblem,
  shiftsForSite,
  zoneForSite,
} from './shiftWindow'

const utc = (y, m, d, h, min = 0) => Date.UTC(y, m - 1, d, h, min)
const local = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime()

describe('openShiftWindow', () => {
  const A = SHIFT_PRESETS[0]
  const C = SHIFT_PRESETS[2]

  it('opens a shift that is underway, in a fixed zone', () => {
    const now = utc(2026, 10, 5, 7, 0)
    const w = openShiftWindow(A, now, { zoneOffsetMinutes: 0 })
    expect(w.startMs).toBe(utc(2026, 10, 5, 6, 0))
    expect(w.endMs).toBe(utc(2026, 10, 5, 14, 0))
  })

  it('opens from 30 minutes before the start and not a minute earlier', () => {
    expect(openShiftWindow(A, utc(2026, 10, 5, 5, 40), { zoneOffsetMinutes: 0 })).not.toBeNull()
    expect(openShiftWindow(A, utc(2026, 10, 5, 5, 29), { zoneOffsetMinutes: 0 })).toBeNull()
  })

  it('closes once the shift has ended', () => {
    expect(openShiftWindow(A, utc(2026, 10, 5, 14, 0), { zoneOffsetMinutes: 0 })).toBeNull()
  })

  it('carries a night shift across midnight', () => {
    const w = openShiftWindow(C, utc(2026, 10, 5, 23, 30), { zoneOffsetMinutes: 0 })
    expect(w.startMs).toBe(utc(2026, 10, 5, 22, 0))
    expect(w.endMs).toBe(utc(2026, 10, 6, 6, 0))
    expect(w.crossesMidnight).toBe(true)
    const after = openShiftWindow(C, utc(2026, 10, 6, 1, 0), { zoneOffsetMinutes: 0 })
    expect(after.startMs).toBe(utc(2026, 10, 5, 22, 0))
  })

  it('uses the browser zone when no site zone is saved', () => {
    const now = local(2026, 10, 5, 7, 0)
    const w = openShiftWindow(A, now)
    expect(w.startMs).toBe(local(2026, 10, 5, 6, 0))
    expect(w.endMs).toBe(local(2026, 10, 5, 14, 0))
  })
})

describe('shiftRequestProblem', () => {
  it('accepts the open occurrence and refuses a hand-typed window of the same length', () => {
    const now = local(2026, 10, 5, 7, 0)
    const open = openShiftWindow(SHIFT_PRESETS[0], now)
    expect(shiftRequestProblem({
      shiftId: 'A',
      shifts: SHIFT_PRESETS,
      nowMs: now,
      windowStartMs: open.startMs,
      windowEndMs: open.endMs,
    })).toBe('')
    expect(shiftRequestProblem({
      shiftId: 'A',
      shifts: SHIFT_PRESETS,
      nowMs: now,
      windowStartMs: now,
      windowEndMs: now + 8 * 3600e3,
    })).toMatch(/cannot be typed/)
  })

  it('refuses a shift that is not the one configured for the site', () => {
    expect(shiftRequestProblem({
      shiftId: 'A',
      shifts: [{ id: 'S1', start: '05:30', end: '08:30', label: 'S1' }],
      nowMs: local(2026, 10, 5, 6, 0),
      windowStartMs: 0,
      windowEndMs: 1,
    })).toMatch(/Choose a shift/)
  })
})

describe('site configuration', () => {
  it('falls back to the defaults until a site is saved', () => {
    expect(shiftsForSite(null, 's1').map((s) => s.id)).toEqual(['A', 'B', 'C', 'general'])
    expect(zoneForSite(null, 's1')).toBeNull()
  })

  it('reads the saved clocks and zone for that site only', () => {
    const settings = {
      sites: {
        s1: { zoneOffsetMinutes: 330, shifts: { S1: { start: '05:30', end: '08:30', label: 'Early' } } },
      },
    }
    expect(shiftsForSite(settings, 's1')).toEqual([
      { id: 'S1', key: 'S1', label: 'Early', start: '05:30', end: '08:30' },
    ])
    expect(zoneForSite(settings, 's1')).toBe(330)
    expect(shiftsForSite(settings, 's2').map((s) => s.id)).toEqual(['A', 'B', 'C', 'general'])
  })

  it('measures a night shift as eight hours, not a negative span', () => {
    expect(shiftDurationMinutes('22:00', '06:00')).toBe(8 * 60)
    expect(shiftDurationMinutes('06:00', '14:00')).toBe(8 * 60)
    expect(shiftDurationMinutes('09:00', '18:00')).toBe(9 * 60)
  })
})
