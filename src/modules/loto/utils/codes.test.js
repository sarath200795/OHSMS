import { buildProcedureCode, numberIsolationPoints, slugCode } from './codes'

describe('slugCode', () => {
  it('uppercases and hyphen-collapses', () => {
    expect(slugCode('Pump A 12')).toBe('PUMP-A-12')
    expect(slugCode('  trailing  ')).toBe('TRAILING')
  })
  it('truncates to max length', () => {
    expect(slugCode('abcdefghijkl', 4)).toBe('ABCD')
  })
})

describe('buildProcedureCode', () => {
  it('joins org-site-equipment slugs', () => {
    expect(buildProcedureCode({ orgName: 'Acme', site: 'Plant 1', equipment: 'UPS 80' })).toBe(
      'ACME-PLANT-1-UPS-80',
    )
  })
})

describe('numberIsolationPoints', () => {
  it('numbers per energy source with the right prefix', () => {
    const out = numberIsolationPoints([
      { energySource: 'electrical' },
      { energySource: 'electrical' },
      { energySource: 'mechanical' },
    ])
    expect(out.map((p) => p.pointId)).toEqual(['E-1', 'E-2', 'M-1'])
    expect(out[0].color).toBeTruthy()
    expect(out[0].energyLabel).toMatch(/Electrical/i)
  })
})
