import { describe, it, expect, beforeAll } from 'vitest'
import { stakeholderAnalytics } from './StakeholderTab'

const SITES = [
  { id: 's1', name: 'Plant 2', region: 'South', entity: 'COCO' },
  { id: 's2', name: 'Depot Chennai', region: 'East', entity: 'FOFO' },
]

const esc = (o = {}) => ({ id: 'e1', title: 'Complaint', status: 'open', members: [], scope: { siteId: 's1' }, ...o })
const leg = (o = {}) => ({
  id: 'l1', title: 'Matter', status: 'open', noticeType: 'none', escalationId: '',
  departments: [], scope: { siteId: 's1' }, ...o,
})

const run = (escalations, legalIssues, opts = {}) =>
  stakeholderAnalytics({ escalations, legalIssues, sites: SITES, ...opts })

describe('scoping', () => {
  it('reads the site off record.scope and keeps only what the viewer may see', () => {
    const a = run(
      [esc(), esc({ id: 'e2', scope: { siteId: 'hidden' } })],
      [leg({ scope: { siteId: 'hidden' } })],
      { keepUnplaced: false }
    )
    expect(a.summary.escalations.total).toBe(1)
    expect(a.summary.legal.total).toBe(0)
  })

  // A record pointing at a site the viewer cannot see is indistinguishable from
  // one with no site at all, so `keepUnplaced` is the only switch over both.
  it('keeps records that resolve to no site only when keepUnplaced', () => {
    const rows = [esc({ scope: {} }), esc({ id: 'e2', scope: { siteId: 'deleted-site' } })]
    expect(run(rows, [], { keepUnplaced: true }).summary.escalations.total).toBe(2)
    expect(run(rows, [], { keepUnplaced: false }).summary.escalations.total).toBe(0)
  })

  it('narrows both collections to a chosen site', () => {
    const a = run(
      [esc(), esc({ id: 'e2', scope: { siteId: 's2' } })],
      [leg(), leg({ id: 'l2', scope: { siteId: 's2' } })],
      { siteId: 's2' }
    )
    expect(a.summary.escalations.total).toBe(1)
    expect(a.summary.legal.total).toBe(1)
  })

  it('prefers the site registry name and falls back to the one stored on the record', () => {
    const a = run(
      [esc({ scope: { siteId: 's1', siteName: 'Plant Two (old name)' } }),
        esc({ id: 'e2', scope: { siteName: 'Closed Depot' } }),
        esc({ id: 'e3', scope: {} })],
      []
    )
    expect(a.bySite.map((r) => r.name).sort()).toEqual(['Closed Depot', 'Plant 2', 'Unassigned'])
  })
})

describe('the crossover', () => {
  // The number the tab exists for: complaints that stopped being complaints.
  it('counts complaints that reached an authority', () => {
    const a = run(
      [esc(), esc({ id: 'e2' })],
      [leg({ escalationId: 'e1', noticeType: 'fir' })]
    )
    expect(a.summary.escalations.escalatedToLegal).toBe(1)
    expect(a.crossover).toHaveLength(1)
    expect(a.crossover[0]).toMatchObject({ id: 'e1', worstNotice: 'fir', siteLabel: 'Plant 2' })
  })

  it('ranks the worst notice first, then by how much is still open', () => {
    const a = run(
      [esc(), esc({ id: 'e2' }), esc({ id: 'e3' })],
      [
        leg({ id: 'l1', escalationId: 'e1', noticeType: 'verbal' }),
        leg({ id: 'l2', escalationId: 'e2', noticeType: 'sealing' }),
        leg({ id: 'l3', escalationId: 'e3', noticeType: 'challan' }),
      ]
    )
    expect(a.crossover.map((e) => e.id)).toEqual(['e2', 'e3', 'e1'])
  })

  // A complaint marked Resolved that produced an FIR is not resolved in any
  // sense the business cares about.
  it('separates complaints closed on our side but still live with an authority', () => {
    const a = run(
      [esc({ id: 'e1', status: 'resolved' }), esc({ id: 'e2', status: 'closed' }), esc({ id: 'e3', status: 'open' })],
      [
        leg({ id: 'l1', escalationId: 'e1', noticeType: 'fir', status: 'open' }),
        leg({ id: 'l2', escalationId: 'e2', noticeType: 'challan', status: 'closed' }),
        leg({ id: 'l3', escalationId: 'e3', noticeType: 'summons', status: 'open' }),
      ]
    )
    expect(a.closedButLive.map((e) => e.id)).toEqual(['e1'])
  })

  // A site filter can strip one end of a link. Reporting the smaller crossover
  // as fact would be wrong, so the count of severed links is surfaced too.
  it('reports legal issues whose complaint is not in scope', () => {
    const a = run(
      [esc({ scope: { siteId: 's2' } })],
      [leg({ escalationId: 'e1' }), leg({ id: 'l2', escalationId: '' })],
      { siteId: 's1' }
    )
    expect(a.summary.escalations.escalatedToLegal).toBe(0)
    expect(a.orphanLegal).toBe(1)
    expect(a.standaloneLegal).toBe(1)
  })
})

describe('departments', () => {
  it('counts one visit under every department that came', () => {
    const a = run([], [leg({ departments: ['police', 'fire'] }), leg({ id: 'l2', departments: ['police'] })])
    expect(a.byDepartment).toEqual([
      { key: 'police', name: 'Police', value: 2 },
      { key: 'fire', name: 'Fire Department / Fire NOC', value: 1 },
    ])
  })

  it('does not count a department twice because it was listed twice', () => {
    const a = run([], [leg({ departments: ['police', 'police', ' police '] })])
    expect(a.byDepartment).toEqual([{ key: 'police', name: 'Police', value: 1 }])
  })

  it('surfaces visits with no department recorded instead of dropping them', () => {
    const a = run([], [leg({ departments: [] })])
    expect(a.byDepartment).toEqual([{ key: '__unrecorded', name: 'Not recorded', value: 1 }])
  })
})

describe('notices', () => {
  // Least to most serious IS the information; sorting by count would bury a
  // single sealing order under a pile of inspection reports.
  it('keeps NOTICE_TYPES order rather than sorting by frequency', () => {
    const a = run([], [
      leg({ id: 'l1', noticeType: 'inspection_report' }),
      leg({ id: 'l2', noticeType: 'inspection_report' }),
      leg({ id: 'l3', noticeType: 'inspection_report' }),
      leg({ id: 'l4', noticeType: 'sealing' }),
    ])
    expect(a.byNotice.map((r) => r.key)).toEqual(['inspection_report', 'sealing'])
  })

  it('drops notice types nobody served and keeps ones it does not recognise', () => {
    const a = run([], [leg({ noticeType: 'seizure_order' })])
    expect(a.byNotice).toEqual([{ key: 'seizure_order', name: 'seizure_order', value: 1, color: '#8a7660' }])
  })

  it('counts only notices with a clock still running as open and serious', () => {
    const a = run([], [
      leg({ id: 'l1', noticeType: 'fir', status: 'open' }),
      leg({ id: 'l2', noticeType: 'fir', status: 'closed' }),
      leg({ id: 'l3', noticeType: 'inspection_report', status: 'open' }),
    ])
    expect(a.summary.legal.severe).toBe(2)
    expect(a.openSevere).toBe(1)
  })
})

describe('status splits', () => {
  it('drops states nobody is in and keeps an unrecognised one visible', () => {
    const a = run(
      [esc({ id: 'e1', status: 'open' }), esc({ id: 'e2', status: 'resolved' }), esc({ id: 'e3', status: 'archived' })],
      [leg({ status: 'complied' })]
    )
    expect(a.escalationStatus.map((r) => r.key)).toEqual(['open', 'resolved', 'archived'])
    expect(a.legalStatus.map((r) => r.key)).toEqual(['complied'])
  })

  it('leaves the rows summing to the population', () => {
    const rows = [esc({ id: 'e1' }), esc({ id: 'e2', status: 'closed' }), esc({ id: 'e3', status: 'in_progress' })]
    const a = run(rows, [])
    expect(a.escalationStatus.reduce((n, r) => n + r.value, 0)).toBe(3)
  })
})

describe('repeat complainants', () => {
  it('marks how many of a member’s complaints reached an authority', () => {
    const a = run(
      [
        esc({ id: 'e1', members: [{ memberId: 'M-1', name: 'Ravi' }] }),
        esc({ id: 'e2', members: [{ memberId: 'M-1', name: 'Ravi' }] }),
        esc({ id: 'e3', members: [{ memberId: 'M-2', name: 'Priya' }] }),
      ],
      [leg({ escalationId: 'e2', noticeType: 'show_cause' })]
    )
    expect(a.repeats).toHaveLength(1)
    expect(a.repeats[0]).toMatchObject({ memberId: 'M-1', count: 2, escalated: 1 })
  })

  it('only counts complaints inside the scope', () => {
    const a = run(
      [
        esc({ id: 'e1', members: [{ memberId: 'M-1' }] }),
        esc({ id: 'e2', scope: { siteId: 's2' }, members: [{ memberId: 'M-1' }] }),
      ],
      [],
      { siteId: 's1' }
    )
    expect(a.repeats).toEqual([])
  })
})

describe('by site', () => {
  it('puts complaints and legal issues on the same row and leads with the crossover', () => {
    const a = run(
      [
        esc({ id: 'e1', scope: { siteId: 's1' } }),
        esc({ id: 'e2', scope: { siteId: 's2' } }),
        esc({ id: 'e3', scope: { siteId: 's2' } }),
      ],
      [
        leg({ id: 'l1', escalationId: 'e2', noticeType: 'fir', scope: { siteId: 's2' } }),
        leg({ id: 'l2', noticeType: 'none', scope: { siteId: 's1' } }),
      ]
    )
    expect(a.bySite).toEqual([
      { key: 's2', name: 'Depot Chennai', complaints: 2, escalated: 1, legal: 1, severe: 1 },
      { key: 's1', name: 'Plant 2', complaints: 1, escalated: 0, legal: 1, severe: 0 },
    ])
  })

  it('lists a site that has only legal issues and no complaints', () => {
    const a = run([], [leg({ scope: { siteId: 's2' } })])
    expect(a.bySite).toEqual([
      { key: 's2', name: 'Depot Chennai', complaints: 0, escalated: 0, legal: 1, severe: 0 },
    ])
  })
})

describe('an empty module', () => {
  it('returns zeroes and empty lists rather than throwing', () => {
    const a = stakeholderAnalytics()
    expect(a.summary.escalations.total).toBe(0)
    expect(a.summary.legal.total).toBe(0)
    expect(a.crossover).toEqual([])
    expect(a.closedButLive).toEqual([])
    expect(a.bySite).toEqual([])
    expect(a.repeats).toEqual([])
    expect(a.orphanLegal).toBe(0)
  })

  it('survives holes in the collections', () => {
    const a = run([null, esc()], [undefined, leg()])
    expect(a.summary.escalations.total).toBe(1)
    expect(a.summary.legal.total).toBe(1)
  })
})

// ── Smoke ────────────────────────────────────────────────────────────────────
// createElement rather than JSX so this stays a .js file alongside the pure
// tests above. It only asserts the tab mounts: the arithmetic is covered above,
// but a wrong import path or a bad prop would only show up here.
describe('the tab itself', () => {
  // Breakdown's ResponsiveContainer observes its own box and jsdom has no
  // ResizeObserver. The charts measure to nothing under jsdom regardless; these
  // assertions are about the text around them.
  beforeAll(() => {
    globalThis.ResizeObserver ||= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  })

  it('renders the crossover and its panels', async () => {
    const { createElement } = await import('react')
    const { render, screen, cleanup } = await import('@testing-library/react')
    const { default: StakeholderTab } = await import('./StakeholderTab')

    render(createElement(StakeholderTab, {
      escalations: [
        esc({ id: 'e1', title: 'Cold food served', status: 'resolved', members: [{ memberId: 'M-1', name: 'Ravi' }] }),
        esc({ id: 'e2', title: 'Rude staff', members: [{ memberId: 'M-1', name: 'Ravi' }] }),
      ],
      legalIssues: [leg({ escalationId: 'e1', noticeType: 'fir', departments: ['police'] })],
      sites: SITES,
      keepUnplaced: true,
    }))

    expect(screen.getByText('Complaints that reached an authority')).toBeTruthy()
    expect(screen.getByText('Cold food served')).toBeTruthy()
    expect(screen.getByText(/marked resolved or closed with a notice still open/)).toBeTruthy()
    expect(screen.getByText('Repeat complainants')).toBeTruthy()
    cleanup()
  })

  it('tells an empty module what to record instead of drawing blank panels', async () => {
    const { createElement } = await import('react')
    const { render, screen, cleanup } = await import('@testing-library/react')
    const { default: StakeholderTab } = await import('./StakeholderTab')

    render(createElement(StakeholderTab, { escalations: [], legalIssues: [], sites: SITES }))
    expect(screen.getByText('No stakeholder issues recorded')).toBeTruthy()
    cleanup()
  })
})
