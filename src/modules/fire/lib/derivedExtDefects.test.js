import { describe, it, expect } from 'vitest'
import { deriveExtinguisherDefects } from './derivedExtDefects'
import { buildDefectRepositoryRows } from './defectRepositoryExport'

const today = new Date(2026, 9, 11)
const base = { status: 'active', serialNo: 'S', centerName: 'Site A', region: 'North', entity: 'E1', location: 'Lobby' }

describe('deriveExtinguisherDefects', () => {
  it('flags HPT overdue and due today, not due soon', () => {
    const rows = deriveExtinguisherDefects([
      { ...base, id: 'a', dateOfNextHPT: '2026-01-01' },
      { ...base, id: 'b', dateOfNextHPT: '2026-10-11' },
      { ...base, id: 'c', dateOfNextHPT: '2026-10-20' },
    ], new Set(), today)
    expect(rows.map((r) => r.id)).toEqual(['a:hpt_due', 'b:hpt_due'])
    expect(rows[0]).toMatchObject({ defectLabel: 'HPT due', dueDate: '2026-01-01', centerName: 'Site A', region: 'North', entity: 'E1', location: 'Lobby' })
  })
  it('flags Empty units and allows both on one unit', () => {
    const rows = deriveExtinguisherDefects([{ ...base, id: 'a', physicalDefects: ['empty', 'pin'], dateOfNextHPT: '2020-01-01' }], new Set(), today)
    expect(rows.map((r) => r.defectLabel)).toEqual(['HPT due', 'Empty'])
  })
  it('skips an HPT closed against the due date the unit still carries', () => {
    const rows = deriveExtinguisherDefects([
      { ...base, id: 'a', dateOfNextHPT: '2020-01-01', hptClosedFor: '2020-01-01' },
    ], new Set(), today)
    expect(rows).toEqual([])
    const moved = deriveExtinguisherDefects([
      { ...base, id: 'a', dateOfNextHPT: '2026-01-01', hptClosedFor: '2020-01-01' },
    ], new Set(), today)
    expect(moved.map((r) => r.id)).toEqual(['a:hpt_due'])
  })
  it('skips deleted, closed and duplicates', () => {
    const rows = deriveExtinguisherDefects([
      { ...base, id: 'd', deletedAt: 1, physicalDefects: ['empty'] },
      { ...base, id: 'c', status: 'closed', physicalDefects: ['empty'], dateOfNextHPT: '2020-01-01' },
      { ...base, id: 'x', physicalDefects: ['empty'] },
    ], new Set(['x:empty']), today)
    expect(rows).toEqual([])
  })
  it('exports derived rows', () => {
    const [r] = deriveExtinguisherDefects([{ ...base, id: 'a', dateOfNextHPT: '2026-01-01' }], new Set(), today)
    const [x] = buildDefectRepositoryRows([{ kind: 'Extinguisher', source: 'derived', defect: r.defectLabel, site: r.centerName, region: r.region, sub: '', raw: r }], {})
    expect(x).toMatchObject({ 'Asset ID / Serial No': 'S', Defect: 'HPT due', Entity: 'E1', Location: 'Lobby', Status: 'Open', Source: 'Derived from extinguisher record', 'Next HPT Due': '2026-01-01' })
  })
})
