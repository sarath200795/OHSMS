import { describe, it, expect } from 'vitest'
import {
  signageCell, isTypeCovered, signageSummary, siteAttributeMap, extCountBySite, EXT_SIGN_TYPE,
  signageStatus, hasSignagePhoto, deployedRequirementErrors,
} from './signageLogic'

const sign = (over = {}) => ({ centerName: 'A', type: 'No Smoking', condition: 'OK', quantity: 1, ...over })

describe('signageCell', () => {
  it('is "none" with no records and "ok" with a healthy one', () => {
    expect(signageCell([], 'No Smoking')).toEqual({ count: 0, status: 'none' })
    expect(signageCell([sign()], 'No Smoking').status).toBe('ok')
  })

  it('reports Missing over a faded sibling, and faded over healthy', () => {
    expect(signageCell([sign(), sign({ condition: 'Missing' })], 'No Smoking').status).toBe('missing')
    expect(signageCell([sign(), sign({ condition: 'Faded' })], 'No Smoking').status).toBe('issue')
  })

  it('scores fire-extinguisher signs against the site’s extinguisher count', () => {
    const t = EXT_SIGN_TYPE
    expect(signageCell([sign({ type: t, quantity: 3 })], t, 5)).toMatchObject({ status: 'issue', label: '3/5' })
    expect(signageCell([sign({ type: t, quantity: 5 })], t, 5)).toMatchObject({ status: 'ok', label: '5/5' })
    // Recorded as Missing does not count toward the fleet.
    expect(signageCell([sign({ type: t, quantity: 5, condition: 'Missing' })], t, 5).status).toBe('missing')
    // A full count still flags when one of the signs is damaged.
    expect(signageCell([sign({ type: t, quantity: 5, condition: 'Damaged' })], t, 5).status).toBe('issue')
    // No extinguishers at the site and no signs recorded is not a gap.
    expect(signageCell([], t, 0)).toEqual({ count: 0, status: 'none' })
  })

  it('scores FERP as floors covered over total floors', () => {
    const ferp = (over) => sign({ type: 'FERP Signage', ...over })
    expect(signageCell([ferp({ totalFloors: 4, allFloors: true })], 'FERP Signage')).toMatchObject({ status: 'ok', label: '4/4' })
    expect(signageCell([ferp({ totalFloors: 4, allFloors: false, floorsCovered: 2 })], 'FERP Signage')).toMatchObject({ status: 'issue', label: '2/4' })
    expect(signageCell([ferp({ totalFloors: 4, allFloors: false, floorsCovered: 0 })], 'FERP Signage').status).toBe('missing')
  })
})

describe('isTypeCovered', () => {
  it('accepts a damaged sign for a normal type but not for the extinguisher sign', () => {
    expect(isTypeCovered('No Smoking', { count: 1, status: 'issue' })).toBe(true)
    expect(isTypeCovered(EXT_SIGN_TYPE, { count: 1, status: 'issue' })).toBe(false)
    expect(isTypeCovered(EXT_SIGN_TYPE, { count: 1, status: 'ok' })).toBe(true)
  })

  // A surveyor recording the sign as absent is the finding. Counting that
  // record as coverage made the matrix draw the cell red while the compliance
  // total counted it green — the one question this module answers, answered
  // both ways at once.
  it('does not count a sign recorded as Missing', () => {
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
    const missing = signageCell([{ condition: 'Missing' }], 'No Smoking')
    expect(missing.status).toBe('missing')
    expect(isTypeCovered('No Smoking', missing)).toBe(false)

    const faded = signageCell([{ condition: 'Faded' }], 'No Smoking')
    expect(faded.status).toBe('issue')
    expect(isTypeCovered('No Smoking', faded)).toBe(true)

    const ok = signageCell([{ condition: 'OK' }], 'No Smoking')
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

  it('rolls up condition and issue counts', () => {
    const s = signageSummary(['A'], [sign({ condition: 'Faded' }), sign({ type: 'First Aid' })], [], TYPES)
    expect(s.byCondition).toEqual({ Faded: 1, OK: 1 })
    expect(s.issue).toBe(1)
    expect(s.bySite[0].issues).toBe(1)
    // A faded sign is still coverage — it shows up as an issue, not a gap.
    expect(s.compliance).toBe(100)
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

describe('hasSignagePhoto', () => {
  it('is true for a stored pointer and for a freshly picked draft', () => {
    expect(hasSignagePhoto({ photo: { path: 'orgs/o/signage-photos/x.jpg' } })).toBe(true)
    expect(hasSignagePhoto({ photo: { dataUrl: 'data:image/jpeg;base64,AA' } })).toBe(true)
    expect(hasSignagePhoto({ photoDraft: 'data:image/jpeg;base64,AA' })).toBe(true)
  })
  it('is false for nothing, null, an empty pointer, or a draft that is not an image data URL', () => {
    expect(hasSignagePhoto(null)).toBe(false)
    expect(hasSignagePhoto({})).toBe(false)
    expect(hasSignagePhoto({ photo: null, photoDraft: '' })).toBe(false)
    expect(hasSignagePhoto({ photo: {} })).toBe(false)
    expect(hasSignagePhoto({ photo: 'orgs/x' })).toBe(false)
    expect(hasSignagePhoto({ photoDraft: 'https://example.com/a.jpg' })).toBe(false)
  })
})

describe('deployedRequirementErrors', () => {
  const photo = { path: 'orgs/o/signage-photos/a.jpg' }
  const ok = { status: 'Deployed', photo, lastChecked: '2026-09-01' }

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
    expect(deployedRequirementErrors({ status: 'Deployed', photo }, null)).toEqual({ lastChecked: 'Enter the last checked date' })
    expect(deployedRequirementErrors({ status: 'Deployed', lastChecked: '2026-09-01' }, null)).toEqual({ photo: 'Add a photo before marking as deployed' })
  })

  it('passes with both, whether the photo is stored or just picked', () => {
    expect(deployedRequirementErrors(ok, null)).toEqual({})
    expect(deployedRequirementErrors({ status: 'Deployed', photoDraft: 'data:image/jpeg;base64,AA', lastChecked: '2026-09-01' }, null)).toEqual({})
  })

  it('treats a blank, whitespace or unparseable date as missing', () => {
    for (const lastChecked of ['', '   ', 'not-a-date', undefined, null, 20260901]) {
      expect(deployedRequirementErrors({ ...ok, lastChecked }, null).lastChecked).toBe('Enter the last checked date')
    }
  })

  it('a removed photo brings the error back', () => {
    expect(deployedRequirementErrors({ ...ok, photo: null }, { status: 'Planned' }).photo).toBe('Add a photo before marking as deployed')
  })

  it('applies to a change from Planned, Removed or unset', () => {
    for (const prev of [{ status: 'Planned' }, { status: 'Removed' }, { status: '' }, {}]) {
      expect(Object.keys(deployedRequirementErrors({ status: 'Deployed' }, prev)).sort()).toEqual(['lastChecked', 'photo'])
    }
  })

  it('leaves a record that was already Deployed alone, so older ones stay editable', () => {
    const legacy = { status: 'Deployed' } // no photo, no date
    expect(deployedRequirementErrors({ ...legacy, location: 'edited' }, legacy)).toEqual({})
  })

  it('still asks when a Deployed record is moved away and back in one edit chain', () => {
    // prev is the STORED state, so editing Removed → Deployed is a new arrival.
    expect(deployedRequirementErrors({ status: 'Deployed' }, { status: 'Removed' })).not.toEqual({})
  })
})
