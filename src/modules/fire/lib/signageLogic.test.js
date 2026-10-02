import { describe, it, expect } from 'vitest'
import {
  signageCell, isTypeCovered, signageSummary, siteAttributeMap, extCountBySite, EXT_SIGN_TYPE,
  signageStatus, hasSignagePhoto, deployedRequirementErrors, isSignageCompliant, signagePhotos,
  signagePhotoCount, requiredSignagePhotos, photoShortfallMessage, signagePhotoProgress, signagePhotoTotals,
} from './signageLogic'

// Compliance comes from status, so the default record is a Deployed one.
const sign = (over = {}) => ({ centerName: 'A', type: 'No Smoking', status: 'Deployed', quantity: 1, ...over })

describe('isSignageCompliant', () => {
  it('is true for Deployed only', () => {
    expect(isSignageCompliant({ status: 'Deployed' })).toBe(true)
    for (const status of ['Planned', 'Removed', '', undefined, 'Bogus']) expect(isSignageCompliant({ status })).toBe(false)
    expect(isSignageCompliant(null)).toBe(false)
  })
  it('ignores a stored condition either way', () => {
    expect(isSignageCompliant({ status: 'Deployed', condition: 'Missing' })).toBe(true)
    expect(isSignageCompliant({ status: 'Planned', condition: 'OK' })).toBe(false)
  })
})

describe('signageCell', () => {
  it('is "none" with no records and "ok" with a Deployed one', () => {
    expect(signageCell([], 'No Smoking')).toEqual({ count: 0, status: 'none' })
    expect(signageCell([sign()], 'No Smoking').status).toBe('ok')
  })

  it('a Planned, Removed or Not-set record is non-compliant', () => {
    for (const status of ['Planned', 'Removed', '', undefined]) {
      expect(signageCell([sign({ status })], 'No Smoking').status).toBe('missing')
    }
  })

  it('a mix of Deployed and non-Deployed is partial', () => {
    expect(signageCell([sign(), sign({ status: 'Planned' })], 'No Smoking').status).toBe('issue')
  })

  it('no longer reads the stored condition', () => {
    expect(signageCell([sign({ condition: 'Missing' })], 'No Smoking').status).toBe('ok')
    expect(signageCell([sign({ status: 'Planned', condition: 'OK' })], 'No Smoking').status).toBe('missing')
  })

  it('scores fire-extinguisher signs against the site’s extinguisher count, deployed ones only', () => {
    const t = EXT_SIGN_TYPE
    expect(signageCell([sign({ type: t, quantity: 3 })], t, 5)).toMatchObject({ status: 'issue', label: '3/5' })
    expect(signageCell([sign({ type: t, quantity: 5 })], t, 5)).toMatchObject({ status: 'ok', label: '5/5' })
    // Not deployed does not count toward the fleet.
    expect(signageCell([sign({ type: t, quantity: 5, status: 'Planned' })], t, 5).status).toBe('missing')
    // A full count still flags when part of it is not deployed.
    expect(signageCell([sign({ type: t, quantity: 5 }), sign({ type: t, quantity: 1, status: 'Removed' })], t, 5).status).toBe('issue')
    // No extinguishers at the site and no signs recorded is not a gap.
    expect(signageCell([], t, 0)).toEqual({ count: 0, status: 'none' })
  })

  it('scores FERP as floors covered over total floors, deployed records only', () => {
    const ferp = (over) => sign({ type: 'FERP Signage', ...over })
    expect(signageCell([ferp({ totalFloors: 4, allFloors: true })], 'FERP Signage')).toMatchObject({ status: 'ok', label: '4/4' })
    expect(signageCell([ferp({ totalFloors: 4, allFloors: false, floorsCovered: 2 })], 'FERP Signage')).toMatchObject({ status: 'issue', label: '2/4' })
    expect(signageCell([ferp({ totalFloors: 4, allFloors: false, floorsCovered: 0 })], 'FERP Signage').status).toBe('missing')
    expect(signageCell([ferp({ totalFloors: 4, allFloors: true, status: 'Planned' })], 'FERP Signage')).toMatchObject({ status: 'missing', label: '0/4' })
  })
})

describe('isTypeCovered', () => {
  it('accepts a partly-deployed normal type but not a partly-deployed extinguisher sign', () => {
    expect(isTypeCovered('No Smoking', { count: 1, status: 'issue' })).toBe(true)
    expect(isTypeCovered(EXT_SIGN_TYPE, { count: 1, status: 'issue' })).toBe(false)
    expect(isTypeCovered(EXT_SIGN_TYPE, { count: 1, status: 'ok' })).toBe(true)
  })

  // A record that is not Deployed is not a sign in place. Counting it as
  // coverage made the matrix draw the cell red while the compliance total
  // counted it green.
  it('does not count a type with no Deployed record', () => {
    expect(isTypeCovered('No Smoking', { count: 1, status: 'missing' })).toBe(false)
    expect(isTypeCovered(EXT_SIGN_TYPE, { count: 1, status: 'missing' })).toBe(false)
  })

  it('does not count a type nobody has recorded at all', () => {
    expect(isTypeCovered('No Smoking', { count: 0, status: 'none' })).toBe(false)
    expect(isTypeCovered(EXT_SIGN_TYPE, { count: 0, status: 'none' })).toBe(false)
  })

  // The matrix and the dashboard read one site through signageCell and
  // isTypeCovered in that order, so the two must never disagree about a cell.
  it('agrees with signageCell on every status it produces', () => {
    const none = signageCell([{ status: 'Planned' }], 'No Smoking')
    expect(none.status).toBe('missing')
    expect(isTypeCovered('No Smoking', none)).toBe(false)

    const part = signageCell([{ status: 'Deployed' }, { status: 'Removed' }], 'No Smoking')
    expect(part.status).toBe('issue')
    expect(isTypeCovered('No Smoking', part)).toBe(true)

    const ok = signageCell([{ status: 'Deployed' }], 'No Smoking')
    expect(ok.status).toBe('ok')
    expect(isTypeCovered('No Smoking', ok)).toBe(true)
  })
})

describe('siteAttributeMap / extCountBySite', () => {
  it('reads the sources in order and keeps the first non-empty value', () => {
    const m = siteAttributeMap('region', [
      [{ centerName: 'A', region: 'North' }],
      [{ centerName: 'A', region: 'South' }, { centerName: 'B', region: 'West' }],
    ])
    expect(m).toEqual({ A: 'North', B: 'West' })
  })

  // The site register is the authority on where a site is; an asset record
  // carries a copy, and a copy can be stale.
  it('lets the site register win over any asset record', () => {
    const m = siteAttributeMap(
      'region',
      [[{ centerName: 'A', region: 'Stale' }]],
      [{ name: 'A', region: 'North' }]
    )
    expect(m).toEqual({ A: 'North' })
  })

  it('still resolves a site the register has never heard of', () => {
    const m = siteAttributeMap('region', [[{ centerName: 'B', region: 'West' }]], [{ name: 'A', region: 'North' }])
    expect(m).toEqual({ A: 'North', B: 'West' })
  })

  // THE DEFECT. The site list is the union of five registers, so a site known
  // only to the AED or fire-alarm register resolved to no region — and the
  // filters compare against this map, so it vanished from every filtered view
  // while still counting in the totals. Twelve of a hundred and sixteen, live.
  it('resolves a site named only by the AED or fire-alarm register', () => {
    const m = siteAttributeMap('region', [
      [], // extinguishers
      [], // signage
      [{ centerName: 'Gold’s Gym', region: 'East' }], // aeds
      [{ centerName: 'Cult Nagole', region: 'East' }], // fas
    ])
    expect(m).toEqual({ 'Gold’s Gym': 'East', 'Cult Nagole': 'East' })
  })

  it('ignores blank values and blank names rather than recording them', () => {
    const m = siteAttributeMap(
      'region',
      [[{ centerName: 'A', region: '' }, { centerName: '  ', region: 'North' }, { centerName: 'A', region: 'South' }]],
      [{ name: 'A', region: '  ' }]
    )
    expect(m).toEqual({ A: 'South' })
  })

  it('is empty, not broken, with nothing to read', () => {
    expect(siteAttributeMap('region')).toEqual({})
    expect(siteAttributeMap('region', [null, undefined], null)).toEqual({})
  })

  it('counts extinguishers per site and ignores unassigned units', () => {
    expect(extCountBySite([{ centerName: 'A' }, { centerName: 'A' }, { centerName: '' }])).toEqual({ A: 2 })
  })
})

describe('signageSummary', () => {
  const TYPES = ['No Smoking', 'First Aid']

  it('counts a site with every type as fully compliant', () => {
    const s = signageSummary(['A'], [sign(), sign({ type: 'First Aid' })], [], TYPES)
    expect(s).toMatchObject({ sites: 1, cells: 2, covered: 2, compliance: 100, fullyCompliant: 1, sitesWithGaps: 0, records: 2 })
    expect(s.bySite[0].missingTypes).toEqual([])
  })

  it('names the missing types on a partly covered site', () => {
    const s = signageSummary(['A'], [sign()], [], TYPES)
    expect(s).toMatchObject({ covered: 1, compliance: 50, notRecorded: 1, sitesWithGaps: 1, fullyCompliant: 0 })
    expect(s.bySite[0].missingTypes).toEqual(['First Aid'])
  })

  it('keeps an unsurveyed site in the denominator', () => {
    const s = signageSummary(['A', 'B'], [sign(), sign({ type: 'First Aid' })], [], TYPES)
    expect(s).toMatchObject({ sites: 2, cells: 4, covered: 2, compliance: 50, sitesWithGaps: 1 })
  })

  it('ignores records belonging to sites outside the scope', () => {
    const s = signageSummary(['A'], [sign(), sign({ centerName: 'Z' })], [], TYPES)
    expect(s.records).toBe(1)
  })

  it('rolls up status and issue counts', () => {
    const s = signageSummary(['A'], [sign(), sign({ status: 'Planned' }), sign({ type: 'First Aid' }), sign({ type: 'First Aid', status: '' })], [], TYPES)
    expect(s.byStatus).toEqual({ Deployed: 2, Planned: 1, 'Not set': 1 })
    expect(s.issue).toBe(2)
    expect(s.bySite[0].issues).toBe(2)
    // Partly deployed is still coverage — it shows up as an issue, not a gap.
    expect(s.compliance).toBe(100)
  })

  it('does not count a site whose only records are not Deployed', () => {
    const s = signageSummary(['A'], [sign({ status: 'Planned' }), sign({ type: 'First Aid', status: 'Removed' })], [], TYPES)
    expect(s).toMatchObject({ covered: 0, compliance: 0, missing: 2, sitesWithGaps: 1 })
  })

  it('carries region and entity onto each site row', () => {
    const s = signageSummary(['A'], [sign()], [{ centerName: 'A', region: 'North', entity: 'COCO' }], TYPES)
    expect(s.bySite[0]).toMatchObject({ site: 'A', region: 'North', entity: 'COCO' })
  })
})

describe('signageStatus', () => {
  it('shows a record with no status (or a stray value) as "Not set"', () => {
    expect(signageStatus({})).toBe('Not set')
    expect(signageStatus({ status: '' })).toBe('Not set')
    expect(signageStatus({ status: 'Bogus' })).toBe('Not set')
    expect(signageStatus(null)).toBe('Not set')
  })
  it('passes the three real statuses through', () => {
    for (const s of ['Planned', 'Deployed', 'Removed']) expect(signageStatus({ status: s })).toBe(s)
  })
})

describe('signagePhotos / hasSignagePhoto', () => {
  const ptr = { path: 'orgs/o/signage-photos/x.jpg' }
  it('reads the photos array', () => {
    expect(signagePhotos({ photos: [ptr, ptr] })).toHaveLength(2)
    expect(signagePhotoCount({ photos: [ptr, 'data:image/jpeg;base64,AA'] })).toBe(2)
  })
  it('reads a legacy single photo as one entry', () => {
    expect(signagePhotos({ photo: ptr })).toEqual([ptr])
    expect(signagePhotos({ photo: { dataUrl: 'data:image/jpeg;base64,AA' } })).toHaveLength(1)
  })
  it('once photos is an array it is the whole truth (no legacy fallback)', () => {
    expect(signagePhotos({ photos: [], photo: ptr })).toEqual([])
  })
  it('drops junk entries', () => {
    expect(signagePhotos({ photos: [null, {}, 'https://x/a.jpg', 5, ptr] })).toEqual([ptr])
  })
  it('is true for a stored pointer and for a freshly picked draft', () => {
    expect(hasSignagePhoto({ photo: ptr })).toBe(true)
    expect(hasSignagePhoto({ photos: [{ dataUrl: 'data:image/jpeg;base64,AA' }] })).toBe(true)
    expect(hasSignagePhoto({ photos: ['data:image/jpeg;base64,AA'] })).toBe(true)
  })
  it('is false for nothing, null, an empty pointer, or a draft that is not an image data URL', () => {
    expect(hasSignagePhoto(null)).toBe(false)
    expect(hasSignagePhoto({})).toBe(false)
    expect(hasSignagePhoto({ photo: null, photos: [] })).toBe(false)
    expect(hasSignagePhoto({ photo: {} })).toBe(false)
    expect(hasSignagePhoto({ photo: 'orgs/x' })).toBe(false)
    expect(hasSignagePhoto({ photos: ['https://example.com/a.jpg'] })).toBe(false)
  })
})

describe('requiredSignagePhotos', () => {
  it('is one for ordinary types', () => {
    expect(requiredSignagePhotos({ type: 'No Smoking', quantity: 7 })).toEqual({ count: 1, per: null })
    expect(requiredSignagePhotos(null)).toEqual({ count: 1, per: null })
  })
  it('is one per extinguisher (the quantity) for the Fire Extinguisher Sign', () => {
    expect(requiredSignagePhotos({ type: EXT_SIGN_TYPE, quantity: 4 })).toEqual({ count: 4, per: 'extinguisher' })
    expect(requiredSignagePhotos({ type: EXT_SIGN_TYPE, quantity: '3' }).count).toBe(3)
    expect(requiredSignagePhotos({ type: EXT_SIGN_TYPE, quantity: '' }).count).toBe(1)
    expect(requiredSignagePhotos({ type: EXT_SIGN_TYPE, quantity: 0 }).count).toBe(1)
  })
  it('is one per floor for FERP: all floors → total, otherwise floors covered', () => {
    expect(requiredSignagePhotos({ type: 'FERP Signage', allFloors: true, totalFloors: 6 })).toEqual({ count: 6, per: 'floor' })
    expect(requiredSignagePhotos({ type: 'FERP Signage', allFloors: false, totalFloors: 6, floorsCovered: 3 })).toEqual({ count: 3, per: 'floor' })
    // covered can't exceed the total (the save clamps the same way)
    expect(requiredSignagePhotos({ type: 'FERP Signage', allFloors: false, totalFloors: 6, floorsCovered: 9 }).count).toBe(6)
    expect(requiredSignagePhotos({ type: 'FERP Signage', allFloors: true, totalFloors: '' }).count).toBe(1)
  })
})

describe('signagePhotoProgress / photoShortfallMessage (information only)', () => {
  const ph = (n) => Array.from({ length: n }, (_, i) => ({ path: `orgs/o/signage-photos/${i}.jpg` }))
  it('reports have / need / missing', () => {
    expect(signagePhotoProgress({ type: EXT_SIGN_TYPE, quantity: 5, photos: ph(2) })).toEqual({ have: 2, need: 5, missing: 3, per: 'extinguisher' })
    expect(signagePhotoProgress({ type: 'FERP Signage', allFloors: true, totalFloors: 3, photos: ph(5) })).toEqual({ have: 5, need: 3, missing: 0, per: 'floor' })
    expect(signagePhotoProgress({ type: 'No Smoking' })).toEqual({ have: 0, need: 1, missing: 1, per: null })
  })
  it('warns softly when some photos are there but fewer than expected', () => {
    expect(photoShortfallMessage({ type: EXT_SIGN_TYPE, quantity: 5, photos: ph(2) })).toContain('2 of 5 photos added')
    expect(photoShortfallMessage({ type: 'FERP Signage', allFloors: true, totalFloors: 4, photos: ph(1) })).toContain('one per floor')
  })
  it('is empty when there are enough, and when there are none (that is the hard error, not the warning)', () => {
    expect(photoShortfallMessage({ type: EXT_SIGN_TYPE, quantity: 2, photos: ph(2) })).toBe('')
    expect(photoShortfallMessage({ type: EXT_SIGN_TYPE, quantity: 2 })).toBe('')
    expect(photoShortfallMessage({ type: 'No Smoking', photos: ph(1) })).toBe('')
  })
})

describe('signagePhotoTotals', () => {
  const ph = (n) => Array.from({ length: n }, (_, i) => ({ path: `p${i}` }))
  it('totals required vs uploaded over Deployed records only and lists the short ones', () => {
    const recs = [
      sign({ type: EXT_SIGN_TYPE, quantity: 5, photos: ph(2) }), // 2/5 short
      sign({ type: 'FERP Signage', allFloors: true, totalFloors: 3, photos: ph(3) }), // 3/3
      sign({ type: 'No Smoking', photos: ph(1) }), // 1/1
      sign({ type: EXT_SIGN_TYPE, quantity: 9, status: 'Planned' }), // not deployed: ignored
    ]
    const t = signagePhotoTotals(recs)
    expect(t).toMatchObject({ required: 9, uploaded: 6, records: 3 })
    expect(t.short).toHaveLength(1)
    expect(t.short[0]).toMatchObject({ have: 2, need: 5, per: 'extinguisher' })
  })
  it('a surplus on one record does not hide a shortfall on another', () => {
    const t = signagePhotoTotals([sign({ photos: ph(4) }), sign({ type: EXT_SIGN_TYPE, quantity: 3, photos: ph(1) })])
    expect(t).toMatchObject({ required: 4, uploaded: 2 })
  })
  it('is empty with nothing deployed', () => {
    expect(signagePhotoTotals([])).toEqual({ required: 0, uploaded: 0, records: 0, short: [] })
  })
})

describe('signageSummary photo totals', () => {
  it('rolls photos up per type, per site and overall', () => {
    const ph = (n) => Array.from({ length: n }, (_, i) => ({ path: `p${i}` }))
    const s = signageSummary(['A'], [
      sign({ type: EXT_SIGN_TYPE, quantity: 4, photos: ph(1) }),
      sign({ type: 'No Smoking', photos: ph(1) }),
    ], [], [EXT_SIGN_TYPE, 'No Smoking'])
    expect(s.photos).toMatchObject({ required: 5, uploaded: 2, records: 2 })
    expect(s.photos.short).toHaveLength(1)
    expect(s.bySite[0]).toMatchObject({ photosRequired: 5, photosUploaded: 2 })
    expect(s.byType.find((t) => t.type === EXT_SIGN_TYPE)).toMatchObject({ photosRequired: 4, photosUploaded: 1 })
  })
})

describe('deployedRequirementErrors', () => {
  const photo = { path: 'orgs/o/signage-photos/a.jpg' }
  const ok = { status: 'Deployed', photos: [photo], lastChecked: '2026-09-01' }

  it('has nothing to say unless the status is Deployed', () => {
    for (const status of ['', 'Planned', 'Removed', undefined]) {
      expect(deployedRequirementErrors({ status }, null)).toEqual({})
    }
    expect(deployedRequirementErrors(null, null)).toEqual({})
  })

  it('asks for both when a new record is Deployed with neither', () => {
    expect(deployedRequirementErrors({ status: 'Deployed' }, null)).toEqual({
      photo: 'Add a photo before marking as deployed',
      lastChecked: 'Enter the last checked date',
    })
  })

  it('asks only for what is missing', () => {
    expect(deployedRequirementErrors({ status: 'Deployed', photos: [photo] }, null)).toEqual({ lastChecked: 'Enter the last checked date' })
    expect(deployedRequirementErrors({ status: 'Deployed', lastChecked: '2026-09-01' }, null)).toEqual({ photo: 'Add a photo before marking as deployed' })
  })

  it('passes with both, whether the photo is stored, legacy, or just picked', () => {
    expect(deployedRequirementErrors(ok, null)).toEqual({})
    expect(deployedRequirementErrors({ status: 'Deployed', photo, lastChecked: '2026-09-01' }, null)).toEqual({})
    expect(deployedRequirementErrors({ status: 'Deployed', photos: ['data:image/jpeg;base64,AA'], lastChecked: '2026-09-01' }, null)).toEqual({})
  })

  it('treats a blank, whitespace or unparseable date as missing', () => {
    for (const lastChecked of ['', '   ', 'not-a-date', undefined, null, 20260901]) {
      expect(deployedRequirementErrors({ ...ok, lastChecked }, null).lastChecked).toBe('Enter the last checked date')
    }
  })

  it('removed photos bring the error back', () => {
    expect(deployedRequirementErrors({ ...ok, photos: [] }, { status: 'Planned' }).photo).toBe('Add a photo before marking as deployed')
  })

  it('FERP and Fire Extinguisher signs need only ONE photo — the fuller count does not block', () => {
    const p = (n) => Array.from({ length: n }, (_, i) => ({ path: `orgs/o/signage-photos/${i}.jpg` }))
    const ferp = { status: 'Deployed', type: 'FERP Signage', allFloors: true, totalFloors: 8, lastChecked: '2026-09-01' }
    const ext = { status: 'Deployed', type: EXT_SIGN_TYPE, quantity: 6, lastChecked: '2026-09-01' }
    expect(deployedRequirementErrors({ ...ferp, photos: p(1) }, null)).toEqual({})
    expect(deployedRequirementErrors({ ...ext, photos: p(2) }, null)).toEqual({})
    // ...but none is still refused, with the plain message
    expect(deployedRequirementErrors({ ...ferp, photos: [] }, null)).toEqual({ photo: 'Add a photo before marking as deployed' })
    expect(deployedRequirementErrors({ ...ext }, null)).toEqual({ photo: 'Add a photo before marking as deployed' })
    // and the date is still required
    expect(deployedRequirementErrors({ ...ext, lastChecked: '', photos: p(6) }, null)).toEqual({ lastChecked: 'Enter the last checked date' })
  })

  it('applies to a change from Planned, Removed or unset', () => {
    for (const prev of [{ status: 'Planned' }, { status: 'Removed' }, { status: '' }, {}]) {
      expect(Object.keys(deployedRequirementErrors({ status: 'Deployed' }, prev)).sort()).toEqual(['lastChecked', 'photo'])
    }
  })

  it('leaves a record that was already Deployed alone, so older ones stay editable', () => {
    const legacy = { status: 'Deployed', type: EXT_SIGN_TYPE, quantity: 5 } // no photo, no date
    expect(deployedRequirementErrors({ ...legacy, location: 'edited' }, legacy)).toEqual({})
    expect(deployedRequirementErrors({ ...legacy, quantity: 8 }, legacy)).toEqual({})
  })

  it('still asks when a Deployed record is moved away and back in one edit chain', () => {
    // prev is the STORED state, so editing Removed → Deployed is a new arrival.
    expect(deployedRequirementErrors({ status: 'Deployed' }, { status: 'Removed' })).not.toEqual({})
  })
})
