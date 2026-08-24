// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { parseSitesCsv, sitesToCsv, hasCoordinates } from './parseSitesCsv'

const csvFile = (text) => new File([text], 'sites.csv', { type: 'text/csv' })

describe('parseSitesCsv — coordinates are mandatory', () => {
  it('accepts rows with valid lat/lng and rejects rows missing either', async () => {
    const csv = [
      'Site Name,Region,Entity,Address,Latitude,Longitude,First Aid Boxes',
      'North Plant,North,Acme,Leeds,53.78,-1.57,4', // valid
      'No Coords,South,Acme,Bristol,,,2', // missing lat + lng → rejected
      'Half Coords,East,Acme,Hull,53.7,,1', // missing lng → rejected
      'Bad Lat,West,Acme,Bath,not-a-number,-2.3,0', // invalid lat → rejected
    ].join('\n')

    const res = await parseSitesCsv(csvFile(csv))
    expect(res.headerOk).toBe(true)
    expect(res.valid).toHaveLength(1)
    expect(res.valid[0].name).toBe('North Plant')
    expect(res.invalid).toHaveLength(3)
    // every rejected row cites a coordinate problem
    expect(res.invalid.every((r) => r.__errors.some((e) => /latitude|longitude/i.test(e)))).toBe(true)
  })

  it('flags a bad header (no lat/lng columns)', async () => {
    const res = await parseSitesCsv(csvFile('Name,Region\nA,North'))
    expect(res.headerOk).toBe(false)
  })

  it('matches flexible headers (lat/long, first aid box)', async () => {
    const csv = 'site,region,entity,address,lat,long,first aid box\nPlant X,N,Acme,Leeds,10,20,3'
    const res = await parseSitesCsv(csvFile(csv))
    expect(res.valid).toHaveLength(1)
    expect(res.valid[0]).toMatchObject({ name: 'Plant X', lat: 10, lng: 20, firstAidBoxes: 3 })
  })
})

describe('exporting the site register', () => {
  const sites = [
    { name: 'North Plant', region: 'North', entity: 'Acme Mfg', address: 'Gelderd Rd, Leeds, UK', lat: 53.7833, lng: -1.5766, firstAidBoxes: 4 },
    { name: 'South Warehouse', region: 'South', entity: 'Acme Logistics', address: 'Avonmouth, Bristol', lat: 51.5045, lng: -2.6997, firstAidBoxes: 2 },
  ]

  it('writes the coordinates the register holds', () => {
    const csv = sitesToCsv(sites)
    expect(csv.split(/\r?\n/)[0]).toBe('Site Name,Region,Entity,Address,Latitude,Longitude,First Aid Boxes')
    expect(csv).toContain('53.7833,-1.5766')
    expect(csv).toContain('51.5045,-2.6997')
  })

  // An address with a comma is the normal case, not the edge case, and a
  // hand-rolled join turns it into two columns and every later field shifts.
  it('quotes a field containing a comma', () => {
    expect(sitesToCsv(sites)).toContain('"Gelderd Rd, Leeds, UK"')
  })

  // 0,0 is a real place in the Gulf of Guinea. A site that never had
  // coordinates has to come back blank, or it gets plotted there.
  it('leaves a missing coordinate blank rather than zero', () => {
    const csv = sitesToCsv([{ name: 'No coords', lat: null, lng: undefined }])
    const row = csv.split(/\r?\n/)[1]
    expect(row).toBe('No coords,,,,,,')
    expect(row).not.toContain('0')
    expect(row).not.toContain('null')
    expect(row).not.toContain('undefined')
  })

  it('carries custom scope columns', () => {
    const custom = [{ key: 'zone', label: 'Zone' }]
    const csv = sitesToCsv([{ name: 'A', attributes: { zone: 'Z1' } }], custom)
    expect(csv.split(/\r?\n/)[0]).toContain('Zone')
    expect(csv).toContain('Z1')
  })

  it('produces a header-only file for an empty register', () => {
    expect(sitesToCsv([]).trim()).toBe('Site Name,Region,Entity,Address,Latitude,Longitude,First Aid Boxes')
    expect(() => sitesToCsv(null)).not.toThrow()
    expect(() => sitesToCsv([null])).not.toThrow()
  })

  // The property the whole shape exists for: what comes out must go back in.
  it('round-trips through the importer', async () => {
    const parsed = await parseSitesCsv(new File([sitesToCsv(sites)], 's.csv', { type: 'text/csv' }))
    expect(parsed.headerOk).toBe(true)
    expect(parsed.invalid).toHaveLength(0)
    expect(parsed.valid.map((r) => [r.name, r.lat, r.lng])).toEqual([
      ['North Plant', 53.7833, -1.5766],
      ['South Warehouse', 51.5045, -2.6997],
    ])
  })
})

describe('knowing whether a site can be mapped', () => {
  it('needs both coordinates, and does not accept a blank as zero', () => {
    expect(hasCoordinates({ lat: 53.8, lng: -1.5 })).toBe(true)
    expect(hasCoordinates({ lat: 0, lng: 0 })).toBe(true)
    expect(hasCoordinates({ lat: 53.8 })).toBe(false)
    expect(hasCoordinates({ lat: '', lng: '' })).toBe(false)
    expect(hasCoordinates({ lat: null, lng: null })).toBe(false)
    expect(hasCoordinates()).toBe(false)
  })
})
