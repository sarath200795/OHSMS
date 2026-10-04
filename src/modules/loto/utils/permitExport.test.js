import { describe, it, expect } from 'vitest'
import {
  PERMIT_HEADERS,
  POINT_HEADERS,
  dashboardStats,
  permitSheetRows,
  permitSummary,
  pointSheetRows,
  safeCell,
} from './permitExport'

const HOUR = 3600 * 1000
const NOW = Date.UTC(2026, 9, 5, 10, 0)

const base = {
  id: 'LP-2026-0001',
  permitNo: 'LP-2026-0001',
  status: 'active',
  workType: 'machine_maintenance',
  reason: 'Replace the hydraulic seal',
  workOrder: 'WO-77',
  equipment: 'Press 4',
  site: 'Plant 2',
  entity: 'Acme Ltd',
  procedureCode: 'ACME-PRESS-4',
  procedureRevision: 2,
  pointCount: 2,
  devices: ['breaker_lockout'],
  shift: 'B',
  windowStart: NOW - 2 * HOUR,
  windowEnd: NOW + 6 * HOUR,
  requestedByName: 'Asha Rao',
  requestedAt: NOW - 3 * HOUR,
  approval: { byName: 'Kiran Admin', at: NOW - 2.5 * HOUR },
  internalPersonnel: [{ uid: 'u2', name: 'Dev Patel' }],
  vendorWorkers: [{ name: 'Tom Hill', company: 'Hydro Co', contact: '555-0100' }],
  isolationPoints: [
    { key: 'a', pointId: 'E-1', energySource: 'electrical', devices: ['breaker_lockout'] },
    { key: 'b', pointId: 'H-1', energySource: 'hydraulic', devices: [] },
  ],
  locks: [
    { pointKey: 'a', lockNo: '112', lockType: 'personal', techName: 'Dev Patel' },
    { pointKey: 'b', lockNo: 'D-9', lockType: 'department' },
  ],
  isolation: {
    at: NOW - 2 * HOUR,
    scans: {
      a: { at: NOW - 2.1 * HOUR, method: 'camera' },
      b: { at: NOW - 2.05 * HOUR, method: 'manual' },
    },
  },
}

describe('permitSummary', () => {
  it('flattens the permit into what a printout shows', () => {
    const s = permitSummary(base, [{ type: 'started', byName: 'Dev Patel' }])
    expect(s.permitNo).toBe('LP-2026-0001')
    expect(s.statusLabel).toBe('Active — locked out')
    expect(s.workType).toBe('Machine maintenance')
    expect(s.procedure).toBe('ACME-PRESS-4 · rev 2')
    expect(s.internal).toEqual(['Dev Patel'])
    expect(s.vendors[0]).toMatchObject({ name: 'Tom Hill', company: 'Hydro Co' })
    expect(s.isolatedBy).toBe('Dev Patel')
    expect(s.points.map((p) => p.pointId)).toEqual(['E-1', 'H-1'])
  })

  it('pairs every point with its lock and how its tag was scanned', () => {
    const [a, b] = permitSummary(base).points
    expect(a).toMatchObject({ lockNo: '112', lockType: 'Personal', scanMethod: 'Camera' })
    expect(b).toMatchObject({ lockNo: 'D-9', lockType: 'Department', scanMethod: 'Manual code' })
    expect(a.scannedAt).not.toBe('')
    expect(a.returnedAt).toBe('')
  })

  it('shows the checklist only once the permit has been returned', () => {
    expect(permitSummary(base).checklist).toBeNull()
    const returned = permitSummary({
      ...base,
      status: 'returned',
      returnChecks: {
        toolsRemoved: true,
        guardsReplaced: true,
        personnelClear: true,
        affectedNotified: false,
      },
      closure: { byName: 'Kiran Admin' },
      closedAt: NOW,
    })
    expect(returned.checklist).toHaveLength(4)
    expect(returned.checklist.filter((c) => c.done)).toHaveLength(3)
    expect(returned.returnedBy).toBe('Kiran Admin')
  })

  it('carries the emergency removal reason and attestations', () => {
    const s = permitSummary({
      ...base,
      status: 'emergency_removed',
      emergency: {
        byName: 'Kiran Admin',
        at: NOW,
        reason: 'Owner left site, line blocked',
        attest: { ownerUnavailable: true, equipmentInspected: true, ownerWillBeTold: false },
      },
    })
    expect(s.emergency.reason).toBe('Owner left site, line blocked')
    expect(s.emergency.attestations.map((a) => a.done)).toEqual([true, true, false])
  })

  it('survives a bare permit', () => {
    const s = permitSummary({ id: 'x' })
    expect(s.permitNo).toBe('x')
    expect(s.points).toEqual([])
    expect(s.emergency).toBeNull()
  })

  it('records a self-approval and its reason', () => {
    const s = permitSummary({
      ...base,
      approval: {
        byName: 'Asha Rao',
        selfApproved: true,
        selfApprovalReason: 'Only admin on site',
      },
    })
    expect(s.selfApproved).toBe(true)
    expect(s.selfApprovalReason).toBe('Only admin on site')
  })
})

describe('spreadsheet rows', () => {
  it('uses the header names as keys, in order', () => {
    const [row] = permitSheetRows([base], NOW)
    expect(Object.keys(row)).toEqual(PERMIT_HEADERS)
    expect(row.Permit).toBe('LP-2026-0001')
    expect(row['Isolation points']).toBe(2)
    expect(row['Internal personnel']).toBe('Dev Patel')
    expect(row.Contractors).toBe('Tom Hill (Hydro Co)')
    expect(row.Clock).toBe('In window')
  })

  it('writes one row per isolation point', () => {
    const rows = pointSheetRows([
      base,
      { ...base, permitNo: 'LP-2026-0002', isolationPoints: [], locks: [] },
    ])
    expect(rows).toHaveLength(2)
    expect(Object.keys(rows[0])).toEqual(POINT_HEADERS)
    expect(rows[0]['Lock no.']).toBe('112')
    expect(rows[1]['Scan method']).toBe('Manual code')
  })

  it('flags an overdue open permit and leaves a closed one blank', () => {
    const late = { ...base, windowEnd: NOW - HOUR }
    expect(permitSheetRows([late], NOW)[0].Clock).toBe('Overdue')
    expect(permitSheetRows([{ ...late, status: 'returned' }], NOW)[0].Clock).toBe('')
  })

  it('neutralises text a spreadsheet would run as a formula', () => {
    expect(safeCell('=HYPERLINK("http://x")')).toBe('\t=HYPERLINK("http://x")')
    expect(safeCell('+1 555')).toBe('\t+1 555')
    expect(safeCell('@SUM(A1)')).toBe('\t@SUM(A1)')
    expect(safeCell('Press 4')).toBe('Press 4')
    expect(safeCell(-3)).toBe(-3)
    expect(safeCell(null)).toBe('')
    const [row] = permitSheetRows([{ ...base, reason: '=cmd|calc', requestedByName: '-2+3' }], NOW)
    expect(row.Job.startsWith('\t=')).toBe(true)
    expect(row['Requested by'].startsWith('\t-')).toBe(true)
  })
})

describe('dashboardStats', () => {
  const permits = [
    { ...base, id: '1' },
    { ...base, id: '2', status: 'requested', windowStart: NOW + HOUR, windowEnd: NOW + 9 * HOUR },
    { ...base, id: '3', windowEnd: NOW - HOUR },
    { ...base, id: '4', windowEnd: NOW + 10 * 60 * 1000 },
    { ...base, id: '5', status: 'returned' },
    { ...base, id: '6', status: 'emergency_removed', windowEnd: NOW - 5 * HOUR },
    { ...base, id: '7', status: 'rejected', windowEnd: NOW - 5 * HOUR },
  ]

  it('counts open, overdue, due and closed permits', () => {
    expect(dashboardStats(permits, NOW)).toEqual({
      open: 4,
      awaiting: 1,
      active: 3,
      due: 1,
      overdue: 1,
      closed: 3,
      emergency: 1,
      total: 7,
    })
  })

  it('never calls a closed permit overdue', () => {
    expect(dashboardStats([permits[5]], NOW).overdue).toBe(0)
  })

  it('lets the server flag make a permit overdue when this clock is slow', () => {
    const flagged = {
      ...base,
      flags: { windowEnd: base.windowEnd, overdueCount: 2, overdueSince: NOW - HOUR },
    }
    expect(dashboardStats([flagged], NOW).overdue).toBe(1)
  })

  it('handles an empty list', () => {
    expect(dashboardStats([], NOW).total).toBe(0)
  })
})
