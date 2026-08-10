import { describe, it, expect } from 'vitest'
import { actionAnalytics, parseDay, daysOverdue, isActionOverdue, ageBand } from './ActionsTab'

const TODAY = '2026-08-10'

const SITES = [
  { id: 's1', name: 'Plant 2' },
  { id: 's2', name: 'Depot Chennai' },
]

// Only the fields the aggregation reads; subscribeActions supplies the rest.
const act = (over) => ({ source: 'incidents', siteId: 's1', owner: 'Ravi', due: '', norm: 'open', ...over })

describe('parseDay', () => {
  it('reads a real day and refuses anything else', () => {
    expect(parseDay('2026-08-10')).toBe(Date.UTC(2026, 7, 10))
    expect(parseDay('')).toBeNull()
    expect(parseDay('2026-8-9')).toBeNull()
    expect(parseDay('next friday')).toBeNull()
  })

  it('refuses a date that does not exist rather than rolling it forward', () => {
    // Date.UTC turns 31 February into 3 March, which would make an impossible
    // due date look like a real one a few days later.
    expect(parseDay('2026-02-31')).toBeNull()
    expect(parseDay('2026-13-01')).toBeNull()
  })
})

describe('daysOverdue', () => {
  it('counts whole days either side of today', () => {
    expect(daysOverdue('2026-08-03', TODAY)).toBe(7)
    expect(daysOverdue('2026-08-10', TODAY)).toBe(0)
    expect(daysOverdue('2026-08-12', TODAY)).toBe(-2)
  })

  it('spans a month boundary as a date, not as text', () => {
    expect(daysOverdue('2026-07-31', TODAY)).toBe(10)
  })

  it('has nothing to say about an undated action', () => {
    expect(daysOverdue('', TODAY)).toBeNull()
  })
})

describe('isActionOverdue', () => {
  it('never counts a done action, however old its due date', () => {
    expect(isActionOverdue({ due: '2020-01-01', norm: 'done' }, TODAY)).toBe(false)
    expect(isActionOverdue({ due: '2020-01-01', norm: 'in_progress' }, TODAY)).toBe(true)
  })

  it('does not treat today or an undated action as overdue', () => {
    expect(isActionOverdue({ due: TODAY, norm: 'open' }, TODAY)).toBe(false)
    expect(isActionOverdue({ due: '', norm: 'open' }, TODAY)).toBe(false)
  })
})

describe('ageBand', () => {
  it('puts each boundary on the side people expect', () => {
    expect(ageBand(91)).toBe('over90')
    expect(ageBand(90)).toBe('over31')
    expect(ageBand(31)).toBe('over31')
    expect(ageBand(30)).toBe('over8')
    expect(ageBand(8)).toBe('over8')
    expect(ageBand(7)).toBe('over1')
    expect(ageBand(1)).toBe('over1')
    expect(ageBand(0)).toBe('today')
    expect(ageBand(-1)).toBe('later')
    expect(ageBand(null)).toBe('nodue')
  })
})

describe('actionAnalytics — scoping', () => {
  const rows = [
    act({ siteId: 's1' }),
    act({ siteId: 's2' }),
    act({ siteId: 'hidden' }),
    act({ siteId: '' }),
  ]

  it('drops actions belonging to a site the viewer cannot see', () => {
    const a = actionAnalytics(rows, SITES, { keepUnplaced: true, today: TODAY })
    expect(a.universeTotal).toBe(3)
  })

  it('keeps unplaced actions only for viewers who see every site', () => {
    expect(actionAnalytics(rows, SITES, { keepUnplaced: true, today: TODAY }).unplaced).toBe(1)
    expect(actionAnalytics(rows, SITES, { keepUnplaced: false, today: TODAY }).universeTotal).toBe(2)
    expect(actionAnalytics(rows, SITES, { keepUnplaced: false, today: TODAY }).unplaced).toBe(0)
  })

  it('reports what the pickers hid rather than shrinking the total silently', () => {
    const a = actionAnalytics(rows, SITES, { siteId: 's1', keepUnplaced: true, today: TODAY })
    expect(a.shown).toBe(1)
    expect(a.universeTotal).toBe(3)
    expect(a.narrowed).toBe(2)
  })

  it('narrows by source module too', () => {
    const mixed = [act({}), act({ source: 'drills' }), act({ source: 'drills' })]
    const a = actionAnalytics(mixed, SITES, { source: 'drills', today: TODAY })
    expect(a.shown).toBe(2)
    expect(a.narrowed).toBe(1)
  })
})

describe('actionAnalytics — status and overdue', () => {
  const rows = [
    act({ norm: 'open', due: '2026-01-01' }),
    act({ norm: 'in_progress', due: '2026-08-09' }),
    act({ norm: 'done', due: '2026-01-01' }),
    act({ norm: 'open', due: '' }),
    act({ norm: 'open', due: '2026-12-31' }),
  ]
  const a = actionAnalytics(rows, SITES, { today: TODAY })

  it('counts the three states', () => {
    expect(a).toMatchObject({ open: 3, inProgress: 1, done: 1, unfinished: 4, shown: 5 })
  })

  it('excludes done work from overdue even when its due date is long past', () => {
    expect(a.overdue).toBe(2)
  })

  it('separates overdue work nobody has picked up from work already underway', () => {
    expect(a.overdueNotStarted).toBe(1)
  })

  it('surfaces the oldest slip and the module carrying most of it', () => {
    expect(a.worstOverdueDays).toBe(daysOverdue('2026-01-01', TODAY))
    expect(a.worstSource).toBe('Incident')
    expect(a.worstSourceCount).toBe(2)
  })

  it('counts unfinished undated actions separately, and never as overdue', () => {
    expect(a.noDue).toBe(1)
  })

  it('leaves the overdue figures empty rather than at zero-days when nothing has slipped', () => {
    const clean = actionAnalytics([act({ due: '2026-12-31' })], SITES, { today: TODAY })
    expect(clean.overdue).toBe(0)
    expect(clean.worstSource).toBe('')
  })

  it('treats an impossible due date as undated instead of overdue', () => {
    const junk = actionAnalytics([act({ due: '2026-02-31' })], SITES, { today: TODAY })
    expect(junk.overdue).toBe(0)
    expect(junk.noDue).toBe(1)
  })
})

describe('actionAnalytics — ageing', () => {
  it('bands unfinished actions worst first and drops empty bands', () => {
    const rows = [
      act({ due: '2026-01-01' }), // 221 days
      act({ due: '2026-06-01' }), // 70 days
      act({ due: '2026-08-08' }), // 2 days
      act({ due: '2026-08-09' }), // 1 day
      act({ due: '', norm: 'done' }),
    ]
    const a = actionAnalytics(rows, SITES, { today: TODAY })
    expect(a.ageing.map((b) => [b.key, b.value])).toEqual([
      ['over90', 1],
      ['over31', 1],
      ['over1', 2],
    ])
  })

  it('bands every unfinished action exactly once', () => {
    const rows = [
      act({ due: '2026-01-01' }),
      act({ due: '2026-08-10' }),
      act({ due: '2026-09-01' }),
      act({ due: '' }),
      act({ due: '2026-01-01', norm: 'done' }),
    ]
    const a = actionAnalytics(rows, SITES, { today: TODAY })
    expect(a.ageing.reduce((n, b) => n + b.value, 0)).toBe(a.unfinished)
  })
})

describe('actionAnalytics — breakdowns', () => {
  it('labels and colours each module from its SOURCE definition', () => {
    const rows = [
      act({ source: 'drills' }),
      act({ source: 'drills' }),
      act({ source: 'incidents' }),
      act({ source: 'incidents', norm: 'done' }),
    ]
    const a = actionAnalytics(rows, SITES, { today: TODAY })
    expect(a.bySource).toEqual([
      { key: 'drills', name: 'Mock Drill', color: '#7c3aed', value: 2, total: 2, overdue: 0 },
      { key: 'incidents', name: 'Incident', color: '#dc2626', value: 1, total: 2, overdue: 0 },
    ])
  })

  it('ranks owners by what they still have open, blanks included as unassigned', () => {
    const rows = [
      act({ owner: 'Ravi' }),
      act({ owner: 'Ravi', norm: 'in_progress', due: '2026-01-01' }),
      act({ owner: 'Ravi', norm: 'done' }),
      act({ owner: '  ' }),
      act({ owner: 'Meena' }),
    ]
    const a = actionAnalytics(rows, SITES, { today: TODAY })
    expect(a.byOwner.map((o) => [o.name, o.value])).toEqual([
      ['Ravi', 2],
      ['Meena', 1],
      ['Unassigned', 1],
    ])
    expect(a.byOwner[0]).toMatchObject({ open: 1, inProgress: 1, overdue: 1 })
  })
})
