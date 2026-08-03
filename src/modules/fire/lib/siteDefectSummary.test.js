import { describe, it, expect } from 'vitest'
import { summariseDefectsBySite, mapsLink } from './siteDefectSummary'

const SITES = [
  { id: 's1', name: 'Cult Gym Ameerpet', address: '12 Main Rd, Ameerpet', region: 'South', entity: 'COCO', lat: 17.4375, lng: 78.4483 },
  { id: 's2', name: 'Depot — Chennai', address: '9 Anna Salai', region: 'East', entity: 'FOFO', lat: 13.0827, lng: 80.2707 },
]

const defect = (centerName, defectLabel, extra = {}) => ({
  centerName, defectLabel, entity: 'COCO', region: 'South', ...extra,
})

describe('mapsLink', () => {
  it('points at the coordinate', () => {
    expect(mapsLink(17.4375, 78.4483)).toBe('https://www.google.com/maps/search/?api=1&query=17.4375,78.4483')
  })

  it('is blank when the site was never mapped, rather than a link to nowhere', () => {
    for (const [a, b] of [[undefined, undefined], [null, null], [NaN, 1], ['17.4', '78.4']]) {
      expect(mapsLink(a, b)).toBe('')
    }
  })

  it('handles a coordinate at the origin, which is a real place and not "missing"', () => {
    expect(mapsLink(0, 0)).toContain('query=0,0')
  })
})

describe('summariseDefectsBySite', () => {
  it('gives one row per site with the count and the types', () => {
    const rows = summariseDefectsBySite([
      defect('Cult Gym Ameerpet', 'PIN'),
      defect('Cult Gym Ameerpet', 'Empty'),
    ], SITES)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      Site: 'Cult Gym Ameerpet',
      'No. of Defects': 2,
      Address: '12 Main Rd, Ameerpet',
      Entity: 'COCO',
      Region: 'South',
      'Location Link': 'https://www.google.com/maps/search/?api=1&query=17.4375,78.4483',
    })
    expect(rows[0]['Type of Defects']).toContain('PIN')
    expect(rows[0]['Type of Defects']).toContain('Empty')
  })

  it('counts a repeated defect type rather than listing it twice', () => {
    const rows = summariseDefectsBySite([
      defect('Cult Gym Ameerpet', 'PIN'),
      defect('Cult Gym Ameerpet', 'PIN'),
      defect('Cult Gym Ameerpet', 'Empty'),
    ], SITES)
    expect(rows[0]['Type of Defects']).toBe('PIN (2), Empty')
  })

  it('does not split one site across two rows when the name is spelled differently', () => {
    // The same lenient match bulk upload uses — otherwise a manager gets two
    // half-counts for one place and visits it twice.
    const rows = summariseDefectsBySite([
      defect('Cult Gym Ameerpet', 'PIN'),
      defect('Cult Ameerpet', 'Empty'),
    ], SITES)
    expect(rows).toHaveLength(1)
    expect(rows[0]['No. of Defects']).toBe(2)
    expect(rows[0].Site).toBe('Cult Gym Ameerpet') // the registry's spelling
  })

  it('puts the worst site first, because the file is a work list', () => {
    const rows = summariseDefectsBySite([
      defect('Depot — Chennai', 'PIN', { entity: 'FOFO', region: 'East' }),
      defect('Cult Gym Ameerpet', 'PIN'),
      defect('Cult Gym Ameerpet', 'Empty'),
      defect('Cult Gym Ameerpet', 'Stand'),
    ], SITES)
    expect(rows.map((r) => r['No. of Defects'])).toEqual([3, 1])
    expect(rows[0].Site).toBe('Cult Gym Ameerpet')
  })

  it('omits sites with no defects', () => {
    const rows = summariseDefectsBySite([defect('Cult Gym Ameerpet', 'PIN')], SITES)
    expect(rows.map((r) => r.Site)).not.toContain('Depot — Chennai')
  })

  it('still reports a site that is not in the registry, with blank address and link', () => {
    // Dropping it would hide real defects because a name did not match.
    const rows = summariseDefectsBySite([defect('Pop-up Site', 'PIN')], SITES)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ Site: 'Pop-up Site', Address: '', 'Location Link': '' })
    expect(rows[0]['No. of Defects']).toBe(1)
  })

  it('groups defects with no site under one heading rather than dropping them', () => {
    const rows = summariseDefectsBySite([defect('', 'PIN'), defect('   ', 'Empty')], SITES)
    expect(rows).toHaveLength(1)
    expect(rows[0].Site).toBe('Unassigned')
    expect(rows[0]['No. of Defects']).toBe(2)
  })

  it('falls back to the registry for entity and region when the unit has none', () => {
    const rows = summariseDefectsBySite(
      [{ centerName: 'Depot — Chennai', defectLabel: 'PIN' }], SITES
    )
    expect(rows[0]).toMatchObject({ Entity: 'FOFO', Region: 'East' })
  })

  it('uses the defect key when there is no label', () => {
    const rows = summariseDefectsBySite([{ centerName: 'Pop-up', defectType: 'pin' }], SITES)
    expect(rows[0]['Type of Defects']).toBe('pin')
  })

  it('says Unspecified rather than blank when a row names no defect at all', () => {
    const rows = summariseDefectsBySite([{ centerName: 'Pop-up' }], SITES)
    expect(rows[0]['Type of Defects']).toBe('Unspecified')
  })

  it('returns nothing for no defects, and survives no registry', () => {
    expect(summariseDefectsBySite([], SITES)).toEqual([])
    expect(summariseDefectsBySite()).toEqual([])
    const rows = summariseDefectsBySite([defect('Anywhere', 'PIN')], [])
    expect(rows[0]).toMatchObject({ Site: 'Anywhere', 'No. of Defects': 1, 'Location Link': '' })
  })

  it('exports every column the report is meant to carry', () => {
    const rows = summariseDefectsBySite([defect('Cult Gym Ameerpet', 'PIN')], SITES)
    expect(Object.keys(rows[0])).toEqual([
      'Site', 'No. of Defects', 'Type of Defects', 'Address', 'Entity', 'Region', 'Location Link',
    ])
  })
})
