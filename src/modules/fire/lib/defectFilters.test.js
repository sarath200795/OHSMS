import { describe, it, expect } from 'vitest'
import {
  emptyDefectFilters, applyDefectFilters, hasActiveDefectFilters, defectFieldDefs, defectExportFilename,
} from './defectFilters'

const rows = [
  { key: 'a', kind: 'Extinguisher', label: 'FE-1', site: 'Alpha', region: 'North', entity: 'COCO', location: 'Lobby', defect: 'Pin missing', source: 'ext', reportedAt: new Date(2026, 8, 5) },
  { key: 'b', kind: 'Extinguisher', label: 'FE-2', site: 'Beta', region: 'South', entity: 'FOFO', defect: 'HPT due', source: 'derived', reportedAt: null, dueDate: '2026-09-20' },
  { key: 'c', kind: 'Extinguisher', label: 'FE-3', site: 'Beta', region: 'South', entity: 'FOFO', defect: 'Empty', source: 'derived', reportedAt: null },
  { key: 'd', kind: 'AED', label: 'AED-1', assetId: 'AED-XYZ', site: 'Alpha', region: 'North', entity: 'COCO', defect: 'Battery', source: 'asset', reportedAt: new Date(2026, 9, 1) },
]
const f = (o) => ({ ...emptyDefectFilters(), ...o })
const keys = (o) => applyDefectFilters(rows, f(o)).map((r) => r.key)

describe('defect filters', () => {
  it('no filters → all rows', () => {
    expect(keys({})).toEqual(['a', 'b', 'c', 'd'])
    expect(hasActiveDefectFilters(f({}))).toBe(false)
  })
  it('search across serial, asset id, location, defect', () => {
    expect(keys({ search: 'fe-2' })).toEqual(['b'])
    expect(keys({ search: 'xyz' })).toEqual(['d'])
    expect(keys({ search: 'lobby' })).toEqual(['a'])
    expect(keys({ search: 'empty' })).toEqual(['c'])
  })
  it('OR within a field, AND across fields', () => {
    expect(keys({ defect: ['HPT due', 'Empty'] })).toEqual(['b', 'c'])
    expect(keys({ region: ['North'], kind: ['AED'] })).toEqual(['d'])
    expect(keys({ entity: ['fofo'] })).toEqual(['b', 'c'])
    expect(keys({ site: ['Alpha'] })).toEqual(['a', 'd'])
  })
  it('source and status', () => {
    expect(keys({ source: ['derived'] })).toEqual(['b', 'c'])
    expect(keys({ source: ['recorded'] })).toEqual(['a', 'd'])
    expect(keys({ status: ['Pending confirmation'] })).toEqual(['d'])
  })
  it('date range uses reported date, else due date; undated rows drop out', () => {
    expect(keys({ from: '2026-09-01', to: '2026-09-30' })).toEqual(['a', 'b'])
    expect(keys({ from: '2026-10-01' })).toEqual(['d'])
    expect(hasActiveDefectFilters(f({ to: '2026-01-01' }))).toBe(true)
  })
  it('field options come from the rows', () => {
    const d = defectFieldDefs(rows)
    expect(d.defect.options.map((o) => o.value)).toEqual(['Battery', 'Empty', 'HPT due', 'Pin missing'])
    expect(d.kind.options.map((o) => o.value)).toEqual(['AED', 'Extinguisher'])
  })
  it('export filename names the filters', () => {
    const now = new Date(2026, 9, 12)
    expect(defectExportFilename(f({}), now)).toBe('equipment-defects-2026-10-12.xlsx')
    expect(defectExportFilename(f({ region: ['North'], defect: ['HPT due'] }), now))
      .toBe('equipment-defects-filtered-hpt-due_north-2026-10-12.xlsx')
  })
})
