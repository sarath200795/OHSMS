import { describe, expect, it } from 'vitest'
import { alertCopy, complianceStats, filterActivity, recordsCsv } from './permitCompliance'

const NOW = Date.parse('2026-10-05T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

describe('complianceStats', () => {
  it('splits the last seven days into on time, late and emergency, and ignores older rows', () => {
    const permits = [
      { status: 'returned', closedAt: NOW - DAY, windowEnd: NOW },
      { status: 'returned', closedAt: NOW - 2 * DAY, windowEnd: NOW - 3 * DAY },
      { status: 'emergency_removed', closedAt: NOW - DAY, windowEnd: NOW },
      { status: 'returned', closedAt: NOW - 30 * DAY, windowEnd: NOW - 30 * DAY },
      { status: 'requested' },
      { status: 'active', windowEnd: NOW - 1000 },
    ]
    const stats = complianceStats(permits, [{ serviceStatus: 'issued' }, { serviceStatus: 'available' }], NOW)
    expect(stats.onTimePct).toBe(33)
    expect(stats.latePct).toBe(33)
    expect(stats.emergencyPct).toBe(33)
    expect(stats.waiting).toBe(1)
    expect(stats.overdue).toBe(1)
    expect(stats.issued).toBe(1)
    expect(stats.totalLocks).toBe(2)
  })
})

describe('filterActivity and recordsCsv', () => {
  it('filters the activity log and prefixes a formula in the CSV', () => {
    const events = [
      { action: 'lock', byName: 'Asha', at: NOW, permitNo: 'LP-1' },
      { action: 'unlock', byName: 'Ben', at: NOW - 1, permitNo: 'LP-2' },
    ]
    expect(filterActivity(events, { q: 'asha' })).toHaveLength(1)
    expect(filterActivity(events, { action: 'unlock' })).toHaveLength(1)
    const csv = recordsCsv([{ id: 'LP-1', status: 'returned', equipment: '=cmd' }])
    expect(csv).toContain('\t=cmd')
  })

  it('words an alert only when something is waiting or overdue', () => {
    expect(alertCopy({ overdue: 2, waiting: 1 })).toBe('2 overdue, 1 waiting for approval')
    expect(alertCopy({ overdue: 0, waiting: 0 })).toBe('')
  })
})
