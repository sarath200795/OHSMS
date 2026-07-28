import { describe, it, expect } from 'vitest'
import { parseCsv, CSV_COLUMNS, templateColumns } from './csv'

const toCsv = (rows) =>
  [CSV_COLUMNS.join(','), ...rows.map((r) => CSV_COLUMNS.map((c) => r[c] ?? '').join(','))].join('\n')
const file = (rows) => new File([toCsv(rows)], 'hira.csv', { type: 'text/csv' })

const base = {
  'Assessment Name': 'Dock Ops',
  Activity: 'Unloading',
  'Hazard Type': 'Manual handling',
  Probability: 3,
  Severity: 2,
  Members: 'Jane Doe; John Roe',
}
const full = { ...base, Region: 'North', Entity: 'Acme', Site: 'HYD8' }

describe('HIRA CSV import — kind-aware validation', () => {
  it('site import REQUIRES region, entity and site', async () => {
    const r = await parseCsv(file([base]), 'site') // no region/entity/site
    expect(r.assessments).toHaveLength(0)
    const issues = r.errors.flatMap((e) => e.issues).join(' ')
    expect(issues).toMatch(/Region is required/)
    expect(issues).toMatch(/Entity is required/)
    expect(issues).toMatch(/Site is required/)
  })

  it('site import with region/entity/site + members is valid', async () => {
    const r = await parseCsv(file([full]), 'site')
    expect(r.assessments).toHaveLength(1)
    expect(r.assessments[0]).toMatchObject({ region: 'North', entity: 'Acme', siteName: 'HYD8' })
    expect(r.assessments[0].members.length).toBeGreaterThanOrEqual(2)
  })

  it('baseline import does NOT require region/entity/site (and strips them)', async () => {
    const r = await parseCsv(file([base]), 'baseline') // no site details, has members
    expect(r.assessments).toHaveLength(1)
    expect(r.assessments[0]).toMatchObject({ region: '', entity: '', siteName: '' })
    expect(r.assessments[0].members.length).toBeGreaterThanOrEqual(2)
  })

  it('members are required for both kinds', async () => {
    const noMembers = { ...full, Members: '', 'Responsible Person': '' }
    const r = await parseCsv(file([noMembers]), 'site')
    expect(r.assessments).toHaveLength(0)
    expect(r.errors.flatMap((e) => e.issues).join(' ')).toMatch(/no members/i)
  })

  it('baseline template omits Region/Entity/Site/Location; site template keeps them', () => {
    const baseCols = templateColumns('baseline')
    expect(baseCols).not.toContain('Site')
    expect(baseCols).not.toContain('Region')
    expect(baseCols).not.toContain('Entity')
    expect(baseCols).not.toContain('Location')
    expect(baseCols).toContain('Members')
    expect(baseCols).toContain('Activity')
    expect(templateColumns('site')).toEqual(CSV_COLUMNS)
  })
})
