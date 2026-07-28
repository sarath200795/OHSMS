import { describe, it, expect } from 'vitest'
import { parseSitesCsv } from './parseSitesCsv'

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
