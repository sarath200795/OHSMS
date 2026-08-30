// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  parseSitesCsv, planImport, updatePayload, sitesToCsv, hasCoordinates, codeIndex, duplicateCodes,
} from './parseSitesCsv'

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
    expect(csv.split(/\r?\n/)[0]).toBe('Site Name,Centre ID,Region,Entity,Address,Latitude,Longitude,First Aid Boxes')
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
    expect(row).toBe('No coords,,,,,,,')
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
    expect(sitesToCsv([]).trim()).toBe('Site Name,Centre ID,Region,Entity,Address,Latitude,Longitude,First Aid Boxes')
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


// ── The centre id ────────────────────────────────────────────────────────────
//
// The column that lets an external dataset join to this register on a KEY
// rather than on a site's name. Its whole value is being unambiguous, so most
// of what is tested here is the refusal to let it stop being one.

const withCode = (rows) => csvFile(
  ['Site Name,Centre ID,Latitude,Longitude', ...rows].join('\n')
)

describe('centre ids in the importer', () => {
  it('reads the column and says the file had one', async () => {
    const r = await parseSitesCsv(withCode(['North Plant,201,53.78,-1.57']))
    expect(r.hasCodes).toBe(true)
    expect(r.valid[0].code).toBe('201')
  })

  it('accepts whatever the producing system called the column', async () => {
    for (const header of ['Centre ID', 'center_service_id', 'Store Code', 'External ID', 'code']) {
      const f = csvFile([`Site Name,${header},Latitude,Longitude`, 'A,77,1,1'].join('\n'))
      const r = await parseSitesCsv(f)
      expect(r.hasCodes, header).toBe(true)
      expect(r.valid[0].code, header).toBe('77')
    }
  })

  it('keeps a leading zero, because a store code is not a number', async () => {
    const r = await parseSitesCsv(withCode(['A,0071,1,1']))
    expect(r.valid[0].code).toBe('0071')
  })

  it('trims the space a spreadsheet paste leaves behind', async () => {
    const r = await parseSitesCsv(withCode(['A, 201 ,1,1']))
    expect(r.valid[0].code).toBe('201')
  })

  it('says so when the file offered no such column', async () => {
    const r = await parseSitesCsv(csvFile(['Site Name,Latitude,Longitude', 'A,1,1'].join('\n')))
    expect(r.hasCodes).toBe(false)
    expect(r.valid[0].code).toBe('')
    // Still importable — the id is optional, it is only its AMBIGUITY that is not.
    expect(r.invalid).toHaveLength(0)
  })

  it('refuses a row whose id another row in the file already used', async () => {
    const r = await parseSitesCsv(withCode(['A,201,1,1', 'B,201,2,2']))
    expect(r.valid.map((x) => x.name)).toEqual(['A'])
    // Named, so nobody has to search a thousand-row sheet for the other one.
    expect(r.invalid[0].__errors[0]).toContain('row 2')
  })

  it('does not refuse a row whose id a site in the register already holds', async () => {
    // That is not a clash — it is how a spreadsheet says "this row IS that
    // site". planImport turns it into an edit; see the upsert tests below.
    const r = await parseSitesCsv(withCode(['A,201,1,1']))
    expect(r.invalid).toHaveLength(0)
  })

  it('does not treat two blank ids as a collision', async () => {
    const r = await parseSitesCsv(withCode(['A,,1,1', 'B,,2,2']))
    expect(r.valid).toHaveLength(2)
  })

  it('round-trips: export the register, edit it, import it back', async () => {
    const csv = sitesToCsv([{ name: 'North Plant', code: '201', lat: 53.78, lng: -1.57 }])
    const r = await parseSitesCsv(csvFile(csv))
    expect(r.invalid).toHaveLength(0)
    expect(r.valid[0]).toMatchObject({ name: 'North Plant', code: '201' })
  })
})

describe('codeIndex and duplicateCodes', () => {
  it('indexes code to site name, ignoring the sites with none', () => {
    const idx = codeIndex([{ code: '1', name: 'A' }, { name: 'B' }, { code: '  ', name: 'C' }])
    expect([...idx.entries()]).toEqual([['1', 'A']])
  })

  it('finds the sites already sharing an id, and names them', () => {
    // Only reachable through data written before the import gained its check,
    // or two admins saving at once — but wrong enough to be worth surfacing.
    const dupes = duplicateCodes([
      { code: '201', name: 'A' }, { code: '201', name: 'B' }, { code: '9', name: 'C' },
    ])
    expect(dupes).toEqual([['201', ['A', 'B']]])
  })

  it('is quiet about a clean register', () => {
    expect(duplicateCodes([{ code: '1', name: 'A' }, { code: '2', name: 'B' }])).toEqual([])
    expect(duplicateCodes([])).toEqual([])
    expect(duplicateCodes()).toEqual([])
  })
})


// ── Re-importing a spreadsheet ───────────────────────────────────────────────
//
// Export the register, fix it, put it back. An importer that only inserts turns
// that into a duplicate of every site, so a row matching something already
// stored has to become an EDIT — and an edit must not quietly destroy the
// columns the spreadsheet did not carry.

const REGISTER = [
  { id: 's1', name: 'North Plant', code: '50', region: 'North', entity: 'Acme', address: 'Leeds', lat: 53.78, lng: -1.57, firstAidBoxes: 4 },
  { id: 's2', name: 'South Warehouse', code: '', region: 'South', entity: 'Acme Logistics', address: 'Bristol', lat: 51.5, lng: -2.69, firstAidBoxes: 2 },
]

const plan = async (header, ...rows) =>
  planImport(await parseSitesCsv(csvFile([header, ...rows].join('\n'))), REGISTER)

describe('planImport — same site updates instead of duplicating', () => {
  it('matches on centre ID and calls it an update', async () => {
    const r = await plan('Site Name,Centre ID,Latitude,Longitude', 'Anything,50,1,2')
    expect(r.creates).toHaveLength(0)
    expect(r.updates).toHaveLength(1)
    expect(r.updates[0].__match).toMatchObject({ id: 's1', name: 'North Plant', by: 'id' })
  })

  it('matches on name when there is no centre ID', async () => {
    const r = await plan('Site Name,Latitude,Longitude', 'South Warehouse,9,9')
    expect(r.updates[0].__match).toMatchObject({ id: 's2', by: 'name' })
  })

  it('matches a name whatever its case and spacing', async () => {
    const r = await plan('Site Name,Latitude,Longitude', '  nORTH   plant ,1,2')
    expect(r.updates[0].__match.id).toBe('s1')
  })

  it('still creates a site nothing matches', async () => {
    const r = await plan('Site Name,Latitude,Longitude', 'Brand New Depot,1,2')
    expect(r.updates).toHaveLength(0)
    expect(r.creates).toHaveLength(1)
  })

  it('lets the centre ID win over the name, and reports the rename', async () => {
    // The ID is a key and a name is not: a renamed site must still match.
    const r = await plan('Site Name,Centre ID,Latitude,Longitude', 'South Warehouse,50,1,2')
    expect(r.updates[0].__match).toMatchObject({ id: 's1', by: 'id', renameTo: 'South Warehouse' })
  })

  it('refuses two rows that would both edit one site', async () => {
    const r = await plan('Site Name,Latitude,Longitude', 'North Plant,1,2', 'north plant,3,4')
    expect(r.updates).toHaveLength(1)
    expect(r.invalid[0].__errors[0]).toContain('Row 2')
  })

  it('never plans an update for a row that was already invalid', async () => {
    const r = await plan('Site Name,Latitude,Longitude', 'North Plant,,')
    expect(r.updates).toHaveLength(0)
    expect(r.creates).toHaveLength(0)
  })

  it('says which fields would change, and says when none would', async () => {
    const same = await plan('Site Name,Latitude,Longitude', 'North Plant,53.78,-1.57')
    expect(same.updates[0].__changes).toEqual({})
    const moved = await plan('Site Name,Latitude,Longitude', 'North Plant,1,2')
    expect(Object.keys(moved.updates[0].__changes)).toEqual(['lat', 'lng'])
  })
})

describe('updatePayload — an import must not blank what it did not carry', () => {
  it('writes only the columns the file had', async () => {
    // Names, IDs and coordinates only. The address, region, entity and first
    // aid boxes already stored must survive untouched.
    const r = await plan('Site Name,Centre ID,Latitude,Longitude', 'North Plant,50,1,2')
    const payload = updatePayload(r.updates[0], REGISTER[0], r.present)
    // No `name` either — it is unchanged, and an unchanged field is not a write.
    expect(payload).toEqual({ code: '50', lat: 1, lng: 2 })
    expect(payload).not.toHaveProperty('address')
    expect(payload).not.toHaveProperty('region')
    expect(payload).not.toHaveProperty('firstAidBoxes')
  })

  it('does write a column the file DID carry, even when blank', async () => {
    // A present-but-empty cell is a deliberate clearing, unlike an absent one.
    const r = await plan('Site Name,Region,Latitude,Longitude', 'North Plant,,1,2')
    const payload = updatePayload(r.updates[0], REGISTER[0], r.present)
    expect(payload.region).toBe('')
  })

  it('merges custom attributes over the stored ones rather than replacing them', async () => {
    const custom = [{ key: 'zone', label: 'Zone' }]
    const parsed = await parseSitesCsv(
      csvFile(['Site Name,Zone,Latitude,Longitude', 'North Plant,Z9,1,2'].join('\n')),
      custom,
    )
    const r = planImport(parsed, [{ ...REGISTER[0], attributes: { zone: 'Z1', shift: 'Nights' } }])
    const payload = updatePayload(r.updates[0], { attributes: { zone: 'Z1', shift: 'Nights' } }, r.present)
    expect(payload.attributes).toEqual({ zone: 'Z9', shift: 'Nights' })
  })

  it('does not restyle a name that differs only in case or spacing', async () => {
    // Matching is case-insensitive, so a hastily typed sheet finds the site.
    // Writing its spelling back would then rename the register on every import.
    const r = await plan('Site Name,Latitude,Longitude', '  nORTH   plant ,1,2')
    const payload = updatePayload(r.updates[0], REGISTER[0], r.present)
    expect(payload).not.toHaveProperty('name')
    expect(r.updates[0].__changes).not.toHaveProperty('name')
  })

  it('does write a real rename through', async () => {
    // Matched on the centre ID, so the different name is a deliberate rename.
    const r = await plan('Site Name,Centre ID,Latitude,Longitude', 'Leeds Plant,50,1,2')
    expect(updatePayload(r.updates[0], REGISTER[0], r.present).name).toBe('Leeds Plant')
  })

  it('leaves attributes alone when the file had no custom columns', async () => {
    const r = await plan('Site Name,Latitude,Longitude', 'North Plant,1,2')
    expect(updatePayload(r.updates[0], REGISTER[0], r.present)).not.toHaveProperty('attributes')
  })
})

describe('the round trip that started all this', () => {
  it('exporting and re-importing the register updates in place, adding nothing', async () => {
    const csv = sitesToCsv(REGISTER)
    const r = planImport(await parseSitesCsv(csvFile(csv)), REGISTER)
    expect(r.creates).toHaveLength(0)
    expect(r.updates).toHaveLength(2)
    // And a clean round trip changes nothing at all.
    expect(r.updates.every((u) => Object.keys(u.__changes).length === 0)).toBe(true)
  })

  it('a corrected coordinate lands on the existing site', async () => {
    const r = await plan('Site Name,Latitude,Longitude', 'North Plant,60.1,-2.2')
    const payload = updatePayload(r.updates[0], REGISTER[0], r.present)
    expect(r.updates[0].__match.id).toBe('s1')
    expect(payload).toMatchObject({ lat: 60.1, lng: -2.2 })
  })
})
