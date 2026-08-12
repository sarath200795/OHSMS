import { describe, it, expect } from 'vitest'
import {
  ON_DEMAND,
  FREQUENCIES,
  RECURRING_FREQUENCIES,
  ASSIGNMENT_FREQUENCIES,
  isOnDemand,
  getPendingOccurrences,
  buildScheduledTasks,
  normalizeTemplateField,
  normalizeTemplateFields,
  normalizeCategory,
  templateCategories,
  usesCategories,
  groupFieldsByCategory,
  UNCATEGORIZED,
} from './schedule'

// An on-demand form is defined by what it does NOT do, and the danger is that
// "does nothing" is indistinguishable from "quietly does the default".
// addFrequencyToDate falls back to +1 month for any frequency it does not
// recognise, so an unguarded 'On Demand' would lay itself out monthly — looking
// exactly like a form someone meant to schedule.
describe('the On Demand frequency', () => {
  it('is offered on a form but not on an assignment', () => {
    expect(FREQUENCIES).toContain(ON_DEMAND)
    // An assignment IS a date; 'One-off' is already the no-cycle answer there.
    expect(ASSIGNMENT_FREQUENCIES).not.toContain(ON_DEMAND)
    expect(ASSIGNMENT_FREQUENCIES[0]).toBe('One-off')
  })

  it('leaves the real cycles untouched', () => {
    expect(RECURRING_FREQUENCIES).toEqual(
      ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Bi-Annually', 'Annually'],
    )
    RECURRING_FREQUENCIES.forEach((f) => expect(isOnDemand(f)).toBe(false))
  })

  it('produces no occurrences even given a wide open window', () => {
    const occ = getPendingOccurrences({
      assignedFrom: '2026-01-01',
      assignedTo: '2027-01-01',
      frequency: ON_DEMAND,
      rangeEnd: new Date(2026, 11, 31),
    })
    expect(occ).toEqual([])
  })

  // The regression guard for the fallback: the same window on a real cycle must
  // still produce dates, or the guard above has been written too broadly.
  it('does not stop a recurring form scheduling', () => {
    const occ = getPendingOccurrences({
      assignedFrom: '2026-01-01',
      assignedTo: '2026-06-01',
      frequency: 'Monthly',
      rangeEnd: new Date(2026, 5, 1),
    })
    expect(occ.length).toBeGreaterThan(1)
    expect(occ[0].dateString).toBe('2026-01-01')
  })

  it('keeps an on-demand form off the calendar, and a monthly one on it', () => {
    const base = {
      status: 'Active',
      assignedFrom: '2026-01-01',
      assignedTo: '2026-12-01',
      siteId: 's1',
      siteName: 'Plant 1',
      fields: [],
      assignments: [],
    }
    const tasks = buildScheduledTasks({
      templates: [
        { ...base, id: 'onDemand', title: 'Spill response check', frequency: ON_DEMAND },
        { ...base, id: 'monthly', title: 'Monthly fire check', frequency: 'Monthly' },
      ],
      records: [],
      currentMonth: new Date(2026, 2, 1),
    })
    expect(tasks.some((t) => t.templateId === 'monthly')).toBe(true)
    expect(tasks.some((t) => t.templateId === 'onDemand')).toBe(false)
  })
})

describe('question categories', () => {
  it('are kept on a field, trimmed, and default to empty', () => {
    expect(normalizeTemplateField({ label: 'Q', category: '  Fire Safety  ' }).category).toBe('Fire Safety')
    expect(normalizeTemplateField({ label: 'Q' }).category).toBe('')
    expect(normalizeCategory(null)).toBe('')
    expect(normalizeCategory(undefined)).toBe('')
  })

  it('survive a round trip through normalizeTemplateFields', () => {
    const out = normalizeTemplateFields([
      { label: 'A', category: 'PPE' },
      { label: 'B' },
    ])
    expect(out.map((f) => f.category)).toEqual(['PPE', ''])
  })

  it('are listed in first-use order, without blanks or duplicates', () => {
    const fields = [
      { label: 'A', category: 'Fire' },
      { label: 'B', category: '' },
      { label: 'C', category: 'PPE' },
      { label: 'D', category: 'Fire' },
    ]
    expect(templateCategories(fields)).toEqual(['Fire', 'PPE'])
  })

  it('only count as "in use" once one is actually set', () => {
    expect(usesCategories([{ label: 'A' }, { label: 'B', category: '  ' }])).toBe(false)
    expect(usesCategories([{ label: 'A', category: 'Fire' }])).toBe(true)
  })
})

describe('grouping a form by category', () => {
  const fields = [
    { id: 'q1', label: 'Exits clear?', category: 'Fire' },
    { id: 'q2', label: 'Helmet worn?', category: 'PPE' },
    { id: 'q3', label: 'Extinguisher in date?', category: 'Fire' },
    { id: 'q4', label: 'Anything else?' },
  ]

  it('merges questions that share a category, wherever they sit on the form', () => {
    const groups = groupFieldsByCategory(fields)
    expect(groups.map((g) => g.category)).toEqual(['Fire', 'PPE', UNCATEGORIZED])
    expect(groups[0].fields.map((f) => f.field.id)).toEqual(['q1', 'q3'])
  })

  // The property that matters most. Submission errors say "Question 3 is
  // unanswered" and a record is read back against the printed form, so a
  // question's number has to be its position on the WHOLE form — not its
  // position inside whichever group it landed in.
  it('numbers questions by their place on the form, not in the group', () => {
    const groups = groupFieldsByCategory(fields)
    const fire = groups[0].fields
    expect(fire.map((f) => f.index)).toEqual([0, 2])
    const flat = groups.flatMap((g) => g.fields)
    expect(flat.map((f) => f.index).sort((a, b) => a - b)).toEqual([0, 1, 2, 3])
    expect(new Set(flat.map((f) => f.index)).size).toBe(fields.length)
  })

  it('files an uncategorised question under General', () => {
    const groups = groupFieldsByCategory([{ id: 'q1', label: 'Solo' }])
    expect(groups).toHaveLength(1)
    expect(groups[0].category).toBe(UNCATEGORIZED)
  })

  it('loses no question, whatever the mix', () => {
    const groups = groupFieldsByCategory(fields)
    expect(groups.flatMap((g) => g.fields)).toHaveLength(fields.length)
  })

  it('copes with an empty form', () => {
    expect(groupFieldsByCategory([])).toEqual([])
    expect(groupFieldsByCategory()).toEqual([])
  })
})
