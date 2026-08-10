import { describe, it, expect } from 'vitest'
import {
  actionAnalytics, parseDay, daysOverdue, isActionOverdue, ageBand, dueMonth, undatedNote,
} from './ActionsTab'

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

describe('dueMonth', () => {
  it('reads the month off a real due date', () => {
    expect(dueMonth('2026-08-10')).toBe('2026-08')
    expect(dueMonth('2026-01-01')).toBe('2026-01')
  })

  it('calls anything the tab cannot parse undated, so one action is never both', () => {
    expect(dueMonth('')).toBe('')
    expect(dueMonth('next friday')).toBe('')
    // February has no 31st. Reading a month off the text would file it under
    // 2026-02 for the range while every other figure counts it as undated.
    expect(dueMonth('2026-02-31')).toBe('')
    expect(dueMonth('2026-8-9')).toBe('')
  })
})

describe('actionAnalytics — due date range', () => {
  const dated = [
    act({ due: '2026-05-15' }),
    act({ due: '2026-06-01' }),
    act({ due: '2026-07-31' }),
    act({ due: '2026-08-20' }),
  ]
  const range = (rows, from, to) => actionAnalytics(rows, SITES, { from, to, today: TODAY })

  it('counts everything when neither end is set', () => {
    expect(range(dated, '', '').shown).toBe(4)
    expect(range(dated, '', '').narrowed).toBe(0)
  })

  it('counts everything when the range spans every month present', () => {
    expect(range(dated, '2026-05', '2026-08').shown).toBe(4)
    expect(range(dated, '2026-05', '2026-08').narrowed).toBe(0)
  })

  it('counts nothing when the range covers months no action falls in', () => {
    const a = range(dated, '2026-01', '2026-02')
    expect(a.shown).toBe(0)
    expect(a.universeTotal).toBe(4)
    expect(a.narrowed).toBe(4)
  })

  it('includes both ends of the range', () => {
    // June and July only: the 1st of the From month and the 31st of the To
    // month are both inside it.
    const a = range(dated, '2026-06', '2026-07')
    expect(a.shown).toBe(2)
    expect(a.narrowed).toBe(2)
  })

  it('treats an unset end as open', () => {
    expect(range(dated, '2026-07', '').shown).toBe(2)
    expect(range(dated, '', '2026-06').shown).toBe(2)
  })

  it('keeps undated actions in the count whatever range is picked', () => {
    const rows = [...dated, act({ due: '' }), act({ due: '2026-02-31' })]
    // A range that excludes every dated action still holds the two the range
    // cannot place — a missing due date is the thing to surface, not to hide.
    const a = range(rows, '2026-01', '2026-02')
    expect(a.shown).toBe(2)
    expect(a.undated).toBe(2)
    expect(range(rows, '2026-05', '2026-08').undated).toBe(2)
  })

  it('counts finished undated actions in undated but never in noDue', () => {
    const rows = [act({ due: '' }), act({ due: '', norm: 'done' }), act({ due: '2026-06-01' })]
    const a = range(rows, '2026-06', '2026-06')
    expect(a.shown).toBe(3)
    expect(a.undated).toBe(2)
    expect(a.noDue).toBe(1)
  })

  it('offers every month the viewer can see, not only the ones the range left', () => {
    const rows = [...dated, act({ due: '' }), act({ due: '2026-02-31' })]
    // Months that vanish as soon as you pick one leave no way back.
    expect(range(rows, '2026-06', '2026-06').months).toEqual(['2026-05', '2026-06', '2026-07', '2026-08'])
  })

  it('narrows the months to what the viewer may see, not what the range hides', () => {
    const rows = [act({ siteId: 'hidden', due: '2026-01-01' }), act({ due: '2026-06-01' })]
    expect(range(rows, '', '').months).toEqual(['2026-06'])
  })

  it('stacks with the site and module filters rather than replacing them', () => {
    const rows = [
      act({ siteId: 's1', source: 'drills', due: '2026-06-01' }),
      act({ siteId: 's2', source: 'drills', due: '2026-06-01' }),
      act({ siteId: 's1', source: 'incidents', due: '2026-06-01' }),
      act({ siteId: 's1', source: 'drills', due: '2026-08-01' }),
    ]
    const a = actionAnalytics(rows, SITES, {
      siteId: 's1', source: 'drills', from: '2026-06', to: '2026-06', today: TODAY,
    })
    expect(a.shown).toBe(1)
    expect(a.narrowed).toBe(3)
  })
})

describe('actionAnalytics — overdue keeps its meaning under a range', () => {
  const rows = [
    act({ due: '2026-01-01' }), // 221 days over
    act({ due: '2026-07-01' }), // 40 days over
    act({ due: '2026-12-01' }), // not yet due
    act({ due: '' }),
  ]

  it('measures overdue against today, not against the end of the range', () => {
    // A range sitting entirely in the future must not make the work in it read
    // as overdue just because the filter moved.
    const a = actionAnalytics(rows, SITES, { from: '2026-11', to: '2026-12', today: TODAY })
    expect(a.overdue).toBe(0)
    expect(a.worstOverdueDays).toBe(0)
  })

  it('reports the longest slip among the actions in scope, still counted from today', () => {
    const a = actionAnalytics(rows, SITES, { from: '2026-07', to: '2026-07', today: TODAY })
    expect(a.overdue).toBe(1)
    expect(a.worstOverdueDays).toBe(daysOverdue('2026-07-01', TODAY))
    // And the tab can say so: the range is one of the filters that narrowed it.
    expect(a.narrowed).toBe(2)
  })

  it('keeps the ageing bands summing to the unfinished actions in scope', () => {
    const a = actionAnalytics(rows, SITES, { from: '2026-07', to: '2026-12', today: TODAY })
    // The two dated actions in range plus the undated one the range cannot place.
    expect(a.unfinished).toBe(3)
    expect(a.ageing.reduce((n, b) => n + b.value, 0)).toBe(a.unfinished)
    expect(a.ageing.find((b) => b.key === 'nodue').value).toBe(1)
  })

  it('never counts a done action as overdue, whatever range holds it', () => {
    const done = [act({ due: '2026-01-01', norm: 'done' })]
    const a = actionAnalytics(done, SITES, { from: '2026-01', to: '2026-01', today: TODAY })
    expect(a.shown).toBe(1)
    expect(a.overdue).toBe(0)
    expect(a.unfinished).toBe(0)
  })
})

describe('undatedNote', () => {
  const once = (s) => s.split('no due date').length - 1

  it('says nothing when every action in scope has a due date', () => {
    expect(undatedNote({ undated: 0, noDue: 0 }, false)).toBe('')
    expect(undatedNote({ undated: 0, noDue: 0 }, true)).toBe('')
  })

  it('stays quiet about undated work that is already finished until a range asks', () => {
    expect(undatedNote({ undated: 3, noDue: 0 }, false)).toBe('')
    expect(undatedNote({ undated: 3, noDue: 0 }, true)).toContain('already done')
  })

  it('reports the unfinished undated actions when no range is set', () => {
    const s = undatedNote({ undated: 7, noDue: 7 }, false)
    expect(s).toContain('7 unfinished actions carry no due date')
    expect(s).toContain('Set a due date')
    expect(s).not.toContain('month range')
  })

  it('adds the range explanation instead of repeating the count somewhere else', () => {
    const s = undatedNote({ undated: 7, noDue: 7 }, true)
    expect(s).toContain('month range')
    // One mention, one wording: two sentences about undated work in two places
    // reads as two separate piles.
    expect(once(s)).toBe(1)
  })

  it('separates the unfinished part when finished undated actions are in scope too', () => {
    const s = undatedNote({ undated: 10, noDue: 7 }, true)
    expect(s).toContain('10 actions in scope carry no due date')
    expect(s).toContain('7 of them unfinished')
    expect(s).toContain('the unfinished ones')
    expect(once(s)).toBe(1)
  })

  it('agrees with itself on a single action', () => {
    const s = undatedNote({ undated: 1, noDue: 1 }, true)
    expect(s).toContain('1 unfinished action carries no due date')
    expect(s).toContain('so it stays counted')
    expect(s).toContain('bring it into this figure')
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
