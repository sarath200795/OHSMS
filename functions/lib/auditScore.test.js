import { describe, expect, it } from 'vitest'
import { TERMINAL_STATUSES } from './metabase.js'
import { OPEN_POINT_TERMINAL, auditPopulation, day0Of, lastSiteAudit, n7Of } from './auditScore.js'

// Invented centres. Nothing here is a real site or a real person.
const site = { id: 's1', name: 'Demo North Hub', code: 'DEMO001', region: 'North' }

const audit = (over = {}) => ({
  siteId: 'DEMO001',
  site: 'Demo North Hub',
  auditDate: '2026-03-02',
  passPct: 82,
  passPctN7: 91,
  status: 'closed',
  count: 1,
  auditType: 'FLS',
  checkpoint: '',
  category: '',
  subCategory: '',
  ...over,
})

const point = (over = {}) => ({
  siteId: 'DEMO001',
  site: 'Demo North Hub',
  auditDate: '2026-03-02',
  status: 'open',
  count: 1,
  auditType: 'FLS',
  checkpoint: 'Exit route blocked',
  category: 'Fire',
  subCategory: '',
  passPct: null,
  ...over,
})

describe('lastSiteAudit', () => {
  it('uses the same pass-rate readers as the dashboard, and the same terminal statuses', () => {
    expect(day0Of({ passPct: 82, checksPassed: 1, checksTotal: 2 })).toBe(82)
    expect(n7Of({ passPctN7: null, checksPassedN7: 9, checksFailedN7: 1 })).toBe(90)
    expect(OPEN_POINT_TERMINAL).toEqual(TERMINAL_STATUSES)
  })

  it('reports the latest scored audit and only the open points from that audit', () => {
    const out = lastSiteAudit(
      site,
      [
        point(),
        point({ checkpoint: 'Pressure low', status: 'in_progress', subCategory: 'Extinguisher' }),
        point({ checkpoint: 'Already fixed', status: 'closed' }),
        point({ checkpoint: 'Not a defect', status: 'rejected' }),
        point({ checkpoint: 'Older gap', auditDate: '2026-01-01' }),
        point({ siteId: 'OTHER', site: 'Demo South Hub', checkpoint: 'Someone else' }),
      ],
      [audit({ auditDate: '2026-01-01', passPct: 40, passPctN7: 40 }), audit()]
    )
    expect(out).toMatchObject({
      date: '2026-03-02',
      scoreOnDay: 82,
      scoreAfter7: 91,
      source: 'audits',
      findingsKnown: true,
      openTotal: 2,
      openMore: 0,
    })
    expect(out.openPoints).toEqual(['Fire: Exit route blocked', 'Extinguisher: Pressure low'])
    expect(out.openPoints.join('\n')).not.toMatch(/fixed|defect|Older|Someone/)
  })

  it('does not let another centre’s later audit become this centre’s score', () => {
    const out = lastSiteAudit(
      site,
      [],
      [audit(), audit({ siteId: 'OTHER', site: 'Other Hub', auditDate: '2026-09-01', passPct: 10 })]
    )
    expect(out.scoreOnDay).toBe(82)
    expect(out.date).toBe('2026-03-02')
  })

  it('joins on the centre id wherever the register stored it', () => {
    const out = lastSiteAudit(
      { id: 's9', name: 'Renamed', attributes: { centerId: 'C-9' } },
      [point({ siteId: 'C-9', site: 'Warehouse spelling', checkpoint: 'Sign missing' })],
      [audit({ siteId: 'C-9', site: 'Warehouse spelling', passPct: 70, passPctN7: null })]
    )
    expect(out).toMatchObject({ date: '2026-03-02', scoreOnDay: 70, scoreAfter7: null })
    expect(out.openPoints).toEqual(['Fire: Sign missing'])
  })

  it('falls back to findings rows that carry a pass rate, which is the dashboard rule', () => {
    const finding = point({ passPct: 64, passPctN7: 80, status: 'open', checkpoint: 'Gap' })
    expect(auditPopulation([finding], [audit({ passPct: null, passPctN7: null })]).source).toBe(
      'findings'
    )
    const out = lastSiteAudit(site, [finding], [audit({ passPct: null, passPctN7: null })])
    expect(out).toMatchObject({ source: 'findings', scoreOnDay: 64, scoreAfter7: 80 })
    expect(out.openPoints).toEqual(['Fire: Gap'])
  })

  it('ignores a later row that has a date and no score', () => {
    const out = lastSiteAudit(
      site,
      [point({ auditDate: '2026-04-01', checkpoint: 'Later note' })],
      [audit(), audit({ auditDate: '2026-04-01', passPct: null, passPctN7: null })]
    )
    expect(out.date).toBe('2026-03-02')
    expect(out.scoreOnDay).toBe(82)
    expect(out.openPoints.join('\n')).not.toMatch(/Later/)
  })

  it('averages several scored rows on the latest day and keeps a single score raw', () => {
    const averaged = lastSiteAudit(site, [], [audit({ passPct: 80 }), audit({ passPct: 100 })])
    expect(averaged.scoreOnDay).toBe(90)
    const lone = lastSiteAudit(site, [], [audit({ passPct: 82.46, passPctN7: 82.46 })])
    expect(lone.scoreOnDay).toBe(82.46)
  })

  it('caps the list and counts a grouped row as that many points', () => {
    const rows = Array.from({ length: 11 }, (_, i) =>
      point({ checkpoint: `Point ${String(i).padStart(2, '0')}` })
    )
    rows.push(point({ checkpoint: 'Grouped', count: 4, status: 'on_hold' }))
    const out = lastSiteAudit(site, rows, [audit()])
    expect(out.openPoints).toHaveLength(10)
    expect(out.openTotal).toBe(15)
    // Open ranks before on hold, so the grouped row is the one left off the list.
    expect(out.openMore).toBe(5)
    expect(out.openPoints.some((line) => line.includes('(4)'))).toBe(false)

    const early = lastSiteAudit(
      site,
      [...rows.slice(0, 11), point({ checkpoint: 'Alarm', count: 4, status: 'open' })],
      [audit()]
    )
    expect(early.openPoints[0]).toBe('Fire: Alarm (4)')
    expect(early.openTotal).toBe(15)
    expect(early.openMore).toBe(2)
  })

  it('drops findings of a different audit type on that day, and keeps one with no type', () => {
    const out = lastSiteAudit(
      site,
      [
        point({ checkpoint: 'In scope' }),
        point({ checkpoint: 'Other programme', auditType: 'Hygiene' }),
        point({ checkpoint: 'Untyped', auditType: '' }),
      ],
      [audit()]
    )
    expect(out.openPoints.map((line) => line.replace(/^.*: /, ''))).toEqual(['In scope', 'Untyped'])
  })

  it('says when the findings question was not available, and when there is no dated audit', () => {
    const missing = lastSiteAudit(site, null, [audit()])
    expect(missing.findingsKnown).toBe(false)
    expect(missing.openPoints).toEqual([])
    expect(lastSiteAudit(site, [], [audit({ auditDate: '' })])).toBeNull()
    expect(lastSiteAudit(site, [point({ siteId: 'NOPE', site: 'Nope' })], [])).toBeNull()
  })
})
