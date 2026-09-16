import { describe, it, expect } from 'vitest'
import {
  standardMerakiName, sitesMissingMeraki, standardMerakiPayloads, merakiDocId,
  sitesWithDuplicateMerakis, redundantMerakis,
} from './provision'

const site = (o = {}) => ({ id: 's1', name: 'Hosur', region: 'South', entity: 'COCO', ...o })
const mk = (o = {}) => ({ id: 'm1', name: 'MX-Hosur', siteId: 's1', status: 'online', ...o })

describe('standardMerakiName', () => {
  it('prefixes the site name so a search finds site and switch together', () => {
    expect(standardMerakiName(site())).toBe('MX-Hosur')
    expect(standardMerakiName(site({ name: 'Plant 2 — Coimbatore' }))).toBe('MX-Plant 2 — Coimbatore')
  })

  it('falls back through name → siteName → id', () => {
    expect(standardMerakiName({ id: 'x', siteName: 'Pune' })).toBe('MX-Pune')
    expect(standardMerakiName({ id: 'abc' })).toBe('MX-abc')
  })

  it('returns nothing when there is nothing to name it after', () => {
    expect(standardMerakiName({})).toBe('')
    expect(standardMerakiName(null)).toBe('')
    expect(standardMerakiName({ name: '   ' })).toBe('')
  })
})

describe('sitesMissingMeraki', () => {
  it('returns sites that have none', () => {
    const out = sitesMissingMeraki([site(), site({ id: 's2', name: 'Pune' })], [mk()])
    expect(out.map((s) => s.id)).toEqual(['s2'])
  })

  // Pressing the button twice must not give a site two switches.
  it('is idempotent — a covered site is never returned again', () => {
    const sites = [site(), site({ id: 's2', name: 'Pune' })]
    const first = standardMerakiPayloads(sites, [])
    expect(first).toHaveLength(2)
    // Simulate them having been created, then run again.
    const created = first.map((p, i) => ({ id: `new${i}`, ...p }))
    expect(sitesMissingMeraki(sites, created)).toEqual([])
  })

  // A rename must not look like a new site.
  it('matches on siteId, not on name', () => {
    const renamed = [site({ name: 'Hosur Plant (renamed)' })]
    expect(sitesMissingMeraki(renamed, [mk()])).toEqual([])
  })

  it('leaves a site alone once it has any Meraki, whatever it is called', () => {
    expect(sitesMissingMeraki([site()], [mk({ name: 'core-switch-01' })])).toEqual([])
  })

  it('tops up only the new sites when more are added later', () => {
    const sites = [site(), site({ id: 's2', name: 'Pune' }), site({ id: 's3', name: 'Delhi' })]
    const out = sitesMissingMeraki(sites, [mk(), mk({ id: 'm2', siteId: 's2' })])
    expect(out.map((s) => s.id)).toEqual(['s3'])
  })

  // A blank-named site still gets one. An ugly "MX-<id>" is visible and can be
  // renamed; a site silently missing its switch is where the cascade stops
  // working and a network outage reads as every camera failing on its own.
  it('still provisions a site whose name is blank, falling back to its id', () => {
    expect(sitesMissingMeraki([{ id: 's9', name: '  ' }], []).map((s) => s.id)).toEqual(['s9'])
    expect(standardMerakiPayloads([{ id: 's9', name: '  ' }], [])[0].name).toBe('MX-s9')
  })

  it('skips a site with no id — it could never be matched again', () => {
    expect(sitesMissingMeraki([{ name: 'Ghost' }], [])).toEqual([])
  })

  it('ignores Meraki records that name no site', () => {
    expect(sitesMissingMeraki([site()], [mk({ siteId: '' })]).map((s) => s.id)).toEqual(['s1'])
  })

  it('survives empty input', () => {
    expect(sitesMissingMeraki()).toEqual([])
    expect(sitesMissingMeraki([], [])).toEqual([])
  })
})

describe('standardMerakiPayloads', () => {
  it('builds a complete, writable document per missing site', () => {
    const [p] = standardMerakiPayloads([site()], [])
    expect(p).toMatchObject({ name: 'MX-Hosur', siteId: 's1', siteName: 'Hosur', status: 'unknown' })
    expect(p.defects).toEqual([])
  })

  // Nothing has checked these switches; a green number nobody verified is worse
  // than an honest "not reported".
  it('does not claim the device is online', () => {
    expect(standardMerakiPayloads([site()], [])[0].status).toBe('unknown')
  })

  it('never emits undefined, which Firestore rejects', () => {
    const [p] = standardMerakiPayloads([{ id: 's1', name: 'Bare' }], [])
    expect(Object.values(p).every((v) => v !== undefined)).toBe(true)
  })

  it('says why the record exists, so a blank IP is not read as missing data', () => {
    expect(standardMerakiPayloads([site()], [])[0].notes).toMatch(/standard Meraki/i)
  })

  // The collection check answers "was this provisioned BEFORE?". It says
  // nothing about the same site arriving twice in one call, which produced two
  // switches from a single run — and no amount of re-reading Firestore first
  // would have caught it, because at read time neither existed yet.
  it('emits one payload for a site listed twice in the same run', () => {
    const out = standardMerakiPayloads([site(), site()], [])
    expect(out).toHaveLength(1)
    expect(out[0].siteId).toBe('s1')
  })

  it('still covers the other sites around a repeated one', () => {
    const rows = [site(), site({ id: 's2', name: 'Pune' }), site(), site({ id: 's3', name: 'Delhi' })]
    expect(standardMerakiPayloads(rows, []).map((p) => p.siteId)).toEqual(['s1', 's2', 's3'])
  })
})

describe('merakiDocId', () => {
  // The point of the derived id: two overlapping runs write the SAME document.
  it('is the same for the same site every time', () => {
    expect(merakiDocId('s1')).toBe(merakiDocId('s1'))
    expect(merakiDocId('s1')).not.toBe(merakiDocId('s2'))
  })

  it('cannot collide with a Firestore auto-id, which is alphanumeric', () => {
    expect(merakiDocId('aBc123')).toMatch(/^site_/)
  })

  it('trims, so a padded id does not address a second document', () => {
    expect(merakiDocId('  s1  ')).toBe(merakiDocId('s1'))
  })

  // Falling back to an auto-id is right here: an unaddressable site still needs
  // its switch, and a site with no Meraki is the failure the module exists to
  // prevent. Returning '' says "use an auto-id", not "skip this site".
  it('refuses ids that cannot go in a path, rather than building a broken one', () => {
    expect(merakiDocId('a/b')).toBe('')
    expect(merakiDocId('.')).toBe('')
    expect(merakiDocId('..')).toBe('')
    expect(merakiDocId('x'.repeat(1001))).toBe('')
  })

  it('survives empty input', () => {
    expect(merakiDocId('')).toBe('')
    expect(merakiDocId(null)).toBe('')
    expect(merakiDocId(undefined)).toBe('')
  })
})

describe('sitesWithDuplicateMerakis', () => {
  const dup = [mk(), mk({ id: 'm2' })]

  it('reports a site carrying two switches', () => {
    const [row] = sitesWithDuplicateMerakis(dup, [site()])
    expect(row.siteId).toBe('s1')
    expect(row.siteName).toBe('Hosur')
    expect(row.devices.map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  it('says nothing about a site with exactly one', () => {
    expect(sitesWithDuplicateMerakis([mk()], [site()])).toEqual([])
  })

  // The register is what people scan; an id nobody recognises is not a report.
  it('names the site from the site list, then the device, then the id', () => {
    expect(sitesWithDuplicateMerakis(dup, [site()])[0].siteName).toBe('Hosur')
    const fromDevice = [mk({ siteName: 'Hosur (as the device has it)' }), mk({ id: 'm2' })]
    expect(sitesWithDuplicateMerakis(fromDevice, [])[0].siteName).toBe('Hosur (as the device has it)')
    const bare = [mk({ siteName: '' }), mk({ id: 'm2', siteName: '' })]
    expect(sitesWithDuplicateMerakis(bare, [])[0].siteName).toBe('s1')
  })

  // A record naming no site is a different defect, and grouping the orphans
  // together would invent one phantom site carrying all of them.
  it('does not treat records naming no site as duplicates of each other', () => {
    expect(sitesWithDuplicateMerakis([mk({ siteId: '' }), mk({ id: 'm2', siteId: '' })], [])).toEqual([])
  })

  it('separates one site with duplicates from another that is fine', () => {
    const rows = [...dup, mk({ id: 'm3', siteId: 's2' })]
    expect(sitesWithDuplicateMerakis(rows, []).map((r) => r.siteId)).toEqual(['s1'])
  })

  it('survives empty input', () => {
    expect(sitesWithDuplicateMerakis()).toEqual([])
    expect(sitesWithDuplicateMerakis([], [])).toEqual([])
  })
})

describe('redundantMerakis', () => {
  // What provisioning writes and nobody has touched since.
  const ghost = (o = {}) => ({
    id: 'g1', name: 'MX-Hosur', siteId: 's1', ipAddress: '', serial: '', model: '',
    status: 'unknown', defects: [],
    notes: 'Created as the standard Meraki for this site — add its IP and model.',
    ...o,
  })
  const real = (o = {}) => ghost({ id: 'r1', ipAddress: '10.0.0.1', notes: 'Rack 3', ...o })

  it('leaves a site with one record alone', () => {
    expect(redundantMerakis([ghost()], 's1').remove).toEqual([])
    expect(redundantMerakis([], 's1').remove).toEqual([])
  })

  it('removes the placeholder and keeps the one somebody filled in', () => {
    const out = redundantMerakis([ghost(), real()], 's1')
    expect(out.remove.map((m) => m.id)).toEqual(['g1'])
    expect(out.keep.map((m) => m.id)).toEqual(['r1'])
    expect(out.blocked).toBe(false)
  })

  // Each of these is somebody's work, or a monitor's answer. Deleting the
  // record throws it away and Firestore has no undo.
  it.each([
    ['an IP', { ipAddress: '10.0.0.9' }],
    ['a serial', { serial: 'Q2XX-1234' }],
    ['a model', { model: 'MX67' }],
    ['a defect on record', { defects: ['power'] }],
    ['a reported status', { status: 'offline' }],
    ['a status somebody confirmed', { status: 'online' }],
    ['a note of its own', { notes: 'Spare, in the cupboard' }],
  ])('treats %s as something to lose', (_label, patch) => {
    const out = redundantMerakis([ghost(), ghost({ id: 'g2', ...patch })], 's1')
    expect(out.remove.map((m) => m.id)).toEqual(['g1'])
  })

  // Which of two maintained records is the real switch is a question about the
  // estate, not about the data. Nothing is deleted; a person is told.
  it('refuses to choose between two records that both hold information', () => {
    const out = redundantMerakis([real(), real({ id: 'r2', ipAddress: '10.0.0.2' })], 's1')
    expect(out.remove).toEqual([])
    expect(out.blocked).toBe(true)
  })

  it('never empties a site, even when every record is a placeholder', () => {
    const out = redundantMerakis([ghost(), ghost({ id: 'g2' }), ghost({ id: 'g3' })], 's1')
    expect(out.keep).toHaveLength(1)
    expect(out.remove).toHaveLength(2)
  })

  // Cleaning up should land the estate on the ids provisioning writes now, so
  // the record that survives is the canonically addressed one where there is
  // one — not whichever happened to sort first.
  it('keeps the canonically addressed record when there is one', () => {
    const out = redundantMerakis([ghost({ id: 'aaa' }), ghost({ id: 'site_s1' })], 's1')
    expect(out.keep.map((m) => m.id)).toEqual(['site_s1'])
  })

  it('otherwise keeps the oldest, so two people get the same answer', () => {
    const out = redundantMerakis(
      [ghost({ id: 'b', createdAt: { seconds: 200 } }), ghost({ id: 'a', createdAt: { seconds: 100 } })],
      's1'
    )
    expect(out.keep.map((m) => m.id)).toEqual(['a'])
  })

  it('prefers a dated record over one with no date at all', () => {
    const out = redundantMerakis([ghost({ id: 'a' }), ghost({ id: 'b', createdAt: { seconds: 5 } })], 's1')
    expect(out.keep.map((m) => m.id)).toEqual(['b'])
  })

  it('falls back to the id so the order is never arbitrary', () => {
    const out = redundantMerakis([ghost({ id: 'z' }), ghost({ id: 'a' })], 's1')
    expect(out.keep.map((m) => m.id)).toEqual(['a'])
  })

  it('accepts a Firestore timestamp, not only a raw seconds field', () => {
    const ts = (ms) => ({ toMillis: () => ms })
    const out = redundantMerakis([ghost({ id: 'b', createdAt: ts(9) }), ghost({ id: 'a', createdAt: ts(2) })], 's1')
    expect(out.keep.map((m) => m.id)).toEqual(['a'])
  })
})
