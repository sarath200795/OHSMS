import { describe, it, expect } from 'vitest'
import {
  filterRecords, checklistOptions, monthOptions, byCategory,
  actionProgress, summary, recordDate, recordMonth,
} from './inspectionAnalytics'

const rec = (over = {}) => ({
  templateId: 't1',
  templateTitle: 'Monthly Fire Check',
  siteId: 's1',
  siteName: 'Plant 1',
  inspector: 'R. Osei',
  completedAt: '2026-03-14T09:00:00.000Z',
  score: 80,
  responses: {},
  ...over,
})

const answer = (a, over = {}) => ({ label: 'Q', category: 'Fire', answer: a, ...over })

describe('narrowing the records', () => {
  const records = [
    rec({ siteId: 's1', templateId: 't1', completedAt: '2026-01-10T00:00:00Z' }),
    rec({ siteId: 's2', templateId: 't1', completedAt: '2026-02-10T00:00:00Z' }),
    rec({ siteId: 's1', templateId: 't2', completedAt: '2026-03-10T00:00:00Z' }),
  ]

  it('filters by site, checklist and month range independently', () => {
    expect(filterRecords(records, { siteId: 's1' })).toHaveLength(2)
    expect(filterRecords(records, { templateId: 't1' })).toHaveLength(2)
    expect(filterRecords(records, { from: '2026-02' })).toHaveLength(2)
    expect(filterRecords(records, { to: '2026-02' })).toHaveLength(2)
    expect(filterRecords(records, { from: '2026-02', to: '2026-02' })).toHaveLength(1)
  })

  it('combines them', () => {
    expect(filterRecords(records, { siteId: 's1', templateId: 't1', from: '2026-01', to: '2026-01' })).toHaveLength(1)
  })

  it('treats a bound as inclusive of its own month', () => {
    expect(filterRecords(records, { from: '2026-03', to: '2026-03' })).toHaveLength(1)
  })

  // Keeping an undated row inside a bounded range would inflate a total that
  // reads as "this quarter", and nothing about the chart would look wrong.
  it('keeps an undated record until a range is set, then drops it', () => {
    const undated = [rec({ completedAt: '', scheduledFor: '', dueString: '' })]
    expect(filterRecords(undated, {})).toHaveLength(1)
    expect(filterRecords(undated, { from: '2026-01' })).toHaveLength(0)
  })

  it('falls back through completedAt, scheduledFor, dueString', () => {
    expect(recordDate(rec({ completedAt: '2026-05-02T10:00:00Z' }))).toBe('2026-05-02')
    expect(recordDate(rec({ completedAt: '', scheduledFor: '2026-06-03' }))).toBe('2026-06-03')
    expect(recordDate(rec({ completedAt: '', scheduledFor: '', dueString: '2026-07-04' }))).toBe('2026-07-04')
    expect(recordMonth(rec({ completedAt: '2026-05-02T10:00:00Z' }))).toBe('2026-05')
  })

  it('offers each checklist once, by name, and every month present', () => {
    expect(checklistOptions(records)).toEqual([
      { id: 't1', title: 'Monthly Fire Check' },
      { id: 't2', title: 'Monthly Fire Check' },
    ])
    expect(monthOptions(records)).toEqual(['2026-01', '2026-02', '2026-03'])
  })

  it('survives junk in the array', () => {
    expect(filterRecords([null, undefined], {})).toEqual([])
    expect(() => byCategory([null])).not.toThrow()
    expect(() => summary(null)).not.toThrow()
  })
})

describe('observations per category', () => {
  const records = [
    rec({
      responses: {
        a: answer('Fail', { category: 'Fire' }),
        b: answer('Pass', { category: 'Fire' }),
        c: answer('Fail', { category: 'PPE' }),
        d: answer('N/A', { category: 'PPE' }),
        e: answer('Pass', { category: '' }),
      },
    }),
    rec({ responses: { f: answer('Fail', { category: 'Fire' }) } }),
  ]

  it('counts failures per category, with the denominator beside them', () => {
    const rows = byCategory(records)
    expect(rows[0]).toMatchObject({ category: 'Fire', observations: 2, pass: 1, checks: 3 })
    expect(rows.find((r) => r.category === 'PPE')).toMatchObject({ observations: 1, na: 1, checks: 2 })
  })

  it('files an uncategorised answer under General', () => {
    expect(byCategory(records).find((r) => r.category === 'General')).toMatchObject({ checks: 1, observations: 0 })
  })

  it('ranks by observations, breaking ties by name so the order is stable', () => {
    const rows = byCategory(records)
    expect(rows.map((r) => r.category)).toEqual(['Fire', 'PPE', 'General'])
  })

  it('reports a rate, because 2 of 40 is not 2 of 2', () => {
    const rows = byCategory(records)
    expect(rows.find((r) => r.category === 'Fire').failRate).toBe(67)
    expect(rows.find((r) => r.category === 'PPE').failRate).toBe(50)
  })

  // History must not move when a question is re-filed on the live checklist.
  it('reads the category off the response, not from anywhere else', () => {
    const rows = byCategory([rec({ responses: { a: answer('Fail', { category: 'Electrical' }) } })])
    expect(rows[0].category).toBe('Electrical')
  })

  it('ignores answers that are not scored checks', () => {
    const rows = byCategory([rec({ responses: { a: { category: 'Fire', answer: 'some text' } } })])
    expect(rows).toEqual([])
  })
})

describe('progress of the actions a failure opened', () => {
  const records = [
    rec({
      responses: {
        a: answer('Fail', { actionStatus: 'closed' }),
        b: answer('Fail', { actionStatus: 'in_progress', actionOwner: 'Sam' }),
        c: answer('Fail', {}), // no status → open
        d: answer('Pass'),
      },
    }),
  ]

  it('counts every failure as an action and splits it by state', () => {
    expect(actionProgress(records)).toMatchObject({ total: 3, done: 1, inProgress: 1, open: 1, completion: 33 })
  })

  it('counts overdue only against items still open', () => {
    const r = [rec({
      responses: {
        a: answer('Fail', { actionDue: '2026-01-01', actionStatus: 'open' }),
        b: answer('Fail', { actionDue: '2026-01-01', actionStatus: 'closed' }),
      },
    })]
    expect(actionProgress(r, '2026-06-01').overdue).toBe(1)
  })

  it('needs a today to call anything overdue', () => {
    const r = [rec({ responses: { a: answer('Fail', { actionDue: '2026-01-01' }) } })]
    expect(actionProgress(r).overdue).toBe(0)
  })

  // The inspector is the fallback owner in the Action Tracker, so a record with
  // an inspector is not unassigned even when nobody was named on the item.
  it('counts an open item as unassigned only when nobody at all owns it', () => {
    const withInspector = [rec({ inspector: 'R. Osei', responses: { a: answer('Fail') } })]
    const orphan = [rec({ inspector: '', responses: { a: answer('Fail') } })]
    expect(actionProgress(withInspector).unassigned).toBe(0)
    expect(actionProgress(orphan).unassigned).toBe(1)
  })

  it('is 0% rather than NaN with nothing to do', () => {
    expect(actionProgress([])).toMatchObject({ total: 0, completion: 0 })
  })
})

describe('the headline numbers', () => {
  it('counts inspections, scored checks and observations', () => {
    const records = [
      rec({ score: 80, responses: { a: answer('Fail'), b: answer('Pass') } }),
      rec({ score: 100, responses: { c: answer('Pass') } }),
    ]
    expect(summary(records)).toMatchObject({ inspections: 2, checks: 3, observations: 1, avgScore: 90 })
  })

  // Averaging over records that never carried a score drags a clean month down.
  it('averages only over records that have a score', () => {
    const records = [rec({ score: 90, responses: {} }), rec({ score: undefined, responses: {} })]
    expect(summary(records).avgScore).toBe(90)
  })

  it('reports no score rather than zero when nothing is scored', () => {
    expect(summary([rec({ score: undefined })]).avgScore).toBeNull()
  })
})
