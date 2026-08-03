import { describe, it, expect } from 'vitest'
import { weatherExportRows, WEATHER_COLUMNS } from './weatherExport'
import { assessWeather } from './weatherRisk'

const SITES = [
  { id: 's1', name: 'Plant 2', region: 'South', entity: 'COCO', lat: 11.01, lng: 76.95 },
  { id: 's2', name: 'Depot', region: 'East', entity: 'FOFO', lat: 13.08, lng: 80.27 },
]

const result = (obs) => ({ obs, risk: assessWeather(obs) })

describe('weatherExportRows', () => {
  it('writes one row per site, with the columns the sheet declares', () => {
    const rows = weatherExportRows(SITES, {
      s1: result({ apparentTempC: 46, windKph: 20, precipMmHr: 0, observedAt: '2026-08-04T10:00' }),
      s2: result({ apparentTempC: 24, windKph: 8, precipMmHr: 6 }),
    })
    expect(rows).toHaveLength(2)
    expect(Object.keys(rows[0])).toEqual(WEATHER_COLUMNS)
  })

  it('carries the verdict, the readings and the map link', () => {
    const [row] = weatherExportRows([SITES[0]], {
      s1: result({ apparentTempC: 46, windKph: 55, precipMmHr: 0, observedAt: '2026-08-04T10:00' }),
    })
    expect(row.Site).toBe('Plant 2')
    expect(row.Risk).toBeTruthy()
    expect(row['Feels Like (°C)']).toBe(46)
    expect(row['Wind (km/h)']).toBe(55)
    expect(row['Location Link']).toContain('query=11.01,76.95')
    expect(row['Checked At']).toBe('2026-08-04T10:00')
  })

  it('gives the rain alert its own column so the sheet can be filtered on it', () => {
    const [low] = weatherExportRows([SITES[0]], { s1: result({ precipMmHr: 1 }) })
    const [med] = weatherExportRows([SITES[0]], { s1: result({ precipMmHr: 6 }) })
    const [high] = weatherExportRows([SITES[0]], { s1: result({ precipMmHr: 15 }) })
    expect([low['Rain Alert'], med['Rain Alert'], high['Rain Alert']]).toEqual(['Low', 'Medium', 'High'])
  })

  it('says None when it is checked and dry, but blank when it was never checked', () => {
    const [dry] = weatherExportRows([SITES[0]], { s1: result({ precipMmHr: 0 }) })
    expect(dry['Rain Alert']).toBe('None')
    const [unchecked] = weatherExportRows([SITES[0]], {})
    expect(unchecked['Rain Alert']).toBe('')
  })

  it('keeps a site whose weather never loaded, rather than dropping it', () => {
    // A site missing from the file reads as "fine", which it is not known to be.
    const rows = weatherExportRows(SITES, { s1: result({ apparentTempC: 20 }) })
    expect(rows).toHaveLength(2)
    expect(rows[1].Risk).toBe('Not checked')
    expect(rows[1].Hazards).toBe('')
  })

  it('lists each hazard with its reading', () => {
    const [row] = weatherExportRows([SITES[0]], {
      s1: result({ apparentTempC: 46, windKph: 65, precipMmHr: 0 }),
    })
    expect(row.Hazards).toContain('Heat stress')
    expect(row.Hazards).toContain('High wind')
    expect(row.Hazards).toMatch(/\(.+\)/)
  })

  it('does not repeat the same guidance twice', () => {
    const [row] = weatherExportRows([SITES[0]], { s1: result({ apparentTempC: 46 }) })
    const affects = row['What It Affects']
    expect(affects).toBeTruthy()
    expect(affects.split('Outdoor and PPE-heavy work').length - 1).toBe(1)
  })

  it('leaves numbers numeric so the sheet can sort and average them', () => {
    const [row] = weatherExportRows([SITES[0]], { s1: result({ apparentTempC: 46, windKph: 20 }) })
    expect(typeof row['Feels Like (°C)']).toBe('number')
    expect(typeof row['Wind (km/h)']).toBe('number')
  })

  it('leaves the link blank for a site with no coordinates', () => {
    const [row] = weatherExportRows([{ id: 'x', name: 'Unmapped' }], {})
    expect(row['Location Link']).toBe('')
  })

  it('survives no sites at all', () => {
    expect(weatherExportRows([], {})).toEqual([])
    expect(weatherExportRows()).toEqual([])
  })
})
