import { describe, it, expect, vi, beforeEach } from 'vitest'

const written = []
vi.mock('xlsx', async (importOriginal) => {
  const actual = await importOriginal()
  const utils = actual.utils
  return {
    ...actual,
    writeFile: (wb, name) => written.push({ wb, name }),
    utils,
  }
})

const { exportPermitsXlsx } = await import('./permitExcel')

const permit = {
  id: 'LP-2026-0001',
  permitNo: 'LP-2026-0001',
  status: 'active',
  workType: 'machine_maintenance',
  reason: '=1+1',
  equipment: 'Press 4',
  windowStart: 1,
  windowEnd: 2,
  isolationPoints: [{ key: 'a', pointId: 'E-1', energySource: 'electrical' }],
  locks: [{ pointKey: 'a', lockNo: '5', lockType: 'department' }],
}

beforeEach(() => {
  written.length = 0
})

describe('exportPermitsXlsx', () => {
  it('writes a Permits and an Isolation points sheet and reports the counts', () => {
    const out = exportPermitsXlsx([permit], 'p.xlsx', 10)
    expect(out).toEqual({ permits: 1, points: 1 })
    expect(written[0].name).toBe('p.xlsx')
    expect(written[0].wb.SheetNames).toEqual(['Permits', 'Isolation points'])
  })

  it('does not store a formula for typed text', () => {
    exportPermitsXlsx([permit], 'p.xlsx', 10)
    const ws = written[0].wb.Sheets.Permits
    const cell = Object.entries(ws).find(([, c]) => c && c.v === '\t=1+1')
    expect(cell).toBeTruthy()
    expect(cell[1].f).toBeUndefined()
  })

  it('still writes the headers for an empty register', () => {
    const out = exportPermitsXlsx([], 'p.xlsx')
    expect(out).toEqual({ permits: 0, points: 0 })
    expect(written[0].wb.Sheets.Permits.A1.v).toBe('Permit')
  })
})
