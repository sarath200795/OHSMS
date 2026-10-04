import { describe, it, expect } from 'vitest'
import {
  toMs,
  permitClock,
  windowFromShift,
  windowProblem,
  windowState,
  formatSpan,
  localDateInput,
} from './permitWindow'

const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()

describe('windowFromShift', () => {
  it('builds a same-day window', () => {
    const w = windowFromShift({ date: '2026-10-05', start: '06:00', end: '14:00' })
    expect(w.startMs).toBe(at(2026, 10, 5, 6))
    expect(w.endMs).toBe(at(2026, 10, 5, 14))
    expect(w.crossesMidnight).toBe(false)
  })

  it('puts the end of a night shift on the NEXT day', () => {
    const w = windowFromShift({ date: '2026-10-05', start: '22:00', end: '06:00' })
    expect(w.startMs).toBe(at(2026, 10, 5, 22))
    expect(w.endMs).toBe(at(2026, 10, 6, 6))
    expect(w.crossesMidnight).toBe(true)
  })

  it('rolls a night shift across a month and year end', () => {
    const w = windowFromShift({ date: '2026-12-31', start: '22:00', end: '06:00' })
    expect(w.endMs).toBe(at(2027, 1, 1, 6))
  })

  it('treats an end equal to the start as a full 24 hours', () => {
    const w = windowFromShift({ date: '2026-10-05', start: '08:00', end: '08:00' })
    expect(w.endMs - w.startMs).toBe(24 * 3600 * 1000)
  })

  it('refuses malformed input rather than building a NaN window', () => {
    expect(windowFromShift({ date: '', start: '06:00', end: '14:00' })).toBeNull()
    expect(windowFromShift({ date: '2026-10-05', start: '6', end: '14:00' })).toBeNull()
    expect(windowFromShift({ date: '2026-10-05', start: '06:00', end: '25:00' })).toBeNull()
    expect(windowFromShift({ date: '2026-02-31', start: '06:00', end: '14:00' })).toBeNull()
  })
})

describe('windowProblem', () => {
  const now = at(2026, 10, 5, 5)
  it('accepts a normal shift', () => {
    const w = windowFromShift({ date: '2026-10-05', start: '06:00', end: '14:00' })
    expect(windowProblem(w.startMs, w.endMs, { nowMs: now })).toBe('')
  })
  it('refuses a window that has already ended', () => {
    const w = windowFromShift({ date: '2026-10-05', start: '01:00', end: '04:00' })
    expect(windowProblem(w.startMs, w.endMs, { nowMs: now })).toMatch(/already ended/)
  })
  it('refuses end before start and non-numbers', () => {
    expect(windowProblem(10, 5, { nowMs: 0 })).toMatch(/after it starts/)
    expect(windowProblem(NaN, 5, { nowMs: 0 })).toMatch(/valid/)
  })
  it('refuses anything longer than a day', () => {
    const start = at(2026, 10, 5, 6)
    expect(windowProblem(start, start + 25 * 3600 * 1000, { nowMs: now })).toMatch(/24 hours/)
  })
})

describe('windowState — against the window end, across midnight', () => {
  const night = windowFromShift({ date: '2026-10-05', start: '22:00', end: '06:00' })
  const permit = { windowStart: night.startMs, windowEnd: night.endMs }

  it('is running at 01:00 on the next day (the time-of-day trap)', () => {
    expect(windowState(permit, at(2026, 10, 6, 1)).state).toBe('running')
  })
  it('is upcoming before the window opens', () => {
    expect(windowState(permit, at(2026, 10, 5, 20)).state).toBe('upcoming')
  })
  it('is due inside the last 30 minutes', () => {
    expect(windowState(permit, at(2026, 10, 6, 5, 40)).state).toBe('due')
  })
  it('is overdue after the end and reports how late', () => {
    const s = windowState(permit, at(2026, 10, 6, 6, 45))
    expect(s.state).toBe('overdue')
    expect(s.overdueMs).toBe(45 * 60 * 1000)
  })
  it('is overdue exactly at the end', () => {
    expect(windowState(permit, night.endMs).state).toBe('overdue')
  })
  it('reads Firestore Timestamp-like values', () => {
    const ts = (ms) => ({ seconds: Math.floor(ms / 1000), nanoseconds: 0 })
    expect(
      windowState({ windowStart: ts(night.startMs), windowEnd: ts(night.endMs) }, night.endMs + 1)
        .state
    ).toBe('overdue')
  })
  it('is unknown, never overdue, when there is no end', () => {
    expect(windowState({}, Date.now()).state).toBe('unknown')
  })
})

describe('small helpers', () => {
  it('toMs handles the shapes Firestore and JSON hand over', () => {
    expect(toMs(5)).toBe(5)
    expect(toMs(new Date(7))).toBe(7)
    expect(toMs({ toMillis: () => 9 })).toBe(9)
    expect(toMs('2026-10-05T00:00:00.000Z')).toBe(Date.parse('2026-10-05T00:00:00.000Z'))
    expect(Number.isNaN(toMs(null))).toBe(true)
    expect(Number.isNaN(toMs('nonsense'))).toBe(true)
  })
  it('formats spans', () => {
    expect(formatSpan(0)).toBe('now')
    expect(formatSpan(12 * 60000)).toBe('12 m')
    expect(formatSpan(65 * 60000)).toBe('1 h 05 m')
    expect(formatSpan(NaN)).toBe('—')
  })
  it('formats the local date for the input', () => {
    expect(localDateInput(at(2026, 3, 9, 15))).toBe('2026-03-09')
  })
})

describe('permitClock', () => {
  const win = { windowStart: at(2026, 10, 5, 6), windowEnd: at(2026, 10, 5, 14) }
  const noon = at(2026, 10, 5, 12)

  it('has no clock for a closed permit', () => {
    for (const status of ['returned', 'rejected', 'withdrawn', 'emergency_removed']) {
      expect(permitClock({ ...win, status }, at(2026, 10, 6, 3))).toBeNull()
    }
  })

  it('runs an open permit against its window end', () => {
    expect(permitClock({ ...win, status: 'active' }, noon).state).toBe('running')
    expect(permitClock({ ...win, status: 'active' }, at(2026, 10, 5, 13, 40)).state).toBe('due')
    expect(permitClock({ ...win, status: 'active' }, at(2026, 10, 5, 14, 1)).state).toBe('overdue')
  })

  it('reads a night shift correctly after midnight', () => {
    const night = {
      status: 'active',
      windowStart: at(2026, 10, 5, 22),
      windowEnd: at(2026, 10, 6, 6),
    }
    // 01:00 the next day is INSIDE the window, not "before 22:00".
    expect(permitClock(night, at(2026, 10, 6, 1)).state).toBe('running')
    expect(permitClock(night, at(2026, 10, 6, 6, 5)).state).toBe('overdue')
  })

  it('lets the server flag escalate a slow browser clock, never soften it', () => {
    const end = win.windowEnd
    const active = { ...win, status: 'active' }
    expect(
      permitClock(
        { ...active, flags: { windowEnd: end, overdueCount: 1, overdueSince: end } },
        noon
      ).state
    ).toBe('overdue')
    expect(permitClock({ ...active, flags: { windowEnd: end, dueAt: 1 } }, noon).state).toBe('due')
    expect(
      permitClock({ ...active, flags: { windowEnd: end, dueAt: 1 } }, at(2026, 10, 5, 15)).state
    ).toBe('overdue')
  })

  it('ignores flags that were computed for a window since extended', () => {
    const stale = {
      ...win,
      status: 'active',
      flags: { windowEnd: win.windowEnd - 3600_000, overdueCount: 4, dueAt: 1 },
    }
    expect(permitClock(stale, noon).state).toBe('running')
  })
})
