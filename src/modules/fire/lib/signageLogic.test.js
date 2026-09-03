import { describe, it, expect } from 'vitest'
import { signageCell, isTypeCovered, signageSummary, siteAttributeMap, extCountBySite, EXT_SIGN_TYPE } from './signageLogic'

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
  it('prefers the extinguisher register and falls back to signage', () => {
    const m = siteAttributeMap('region', [{ centerName: 'A', region: 'North' }], [
      { centerName: 'A', region: 'South' },
      { centerName: 'B', region: 'West' },
    ])
    expect(m).toEqual({ A: 'North', B: 'West' })
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
