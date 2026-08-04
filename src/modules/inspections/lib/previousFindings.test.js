import { describe, it, expect } from 'vitest'
import { findLastInspection, openFindings, previousInspection } from './previousFindings'

const rec = (id, over = {}) => ({
  id,
  templateId: 't1',
  siteId: 's1',
  completedAt: '2026-01-01T09:00:00.000Z',
  responses: {},
  ...over,
})

const answers = (map) =>
  Object.fromEntries(Object.entries(map).map(([k, v]) => [k, { label: `Q ${k}`, answer: v }]))

describe('findLastInspection', () => {
  it('picks the most recent run of the same form at the same site', () => {
    const records = [
      rec('a', { completedAt: '2026-01-01T09:00:00.000Z' }),
      rec('c', { completedAt: '2026-03-01T09:00:00.000Z' }),
      rec('b', { completedAt: '2026-02-01T09:00:00.000Z' }),
    ]
    expect(findLastInspection(records, { templateId: 't1', siteId: 's1' }).id).toBe('c')
  })

  it('ignores a different form, because it asks different questions', () => {
    const records = [rec('a', { templateId: 't2' })]
    expect(findLastInspection(records, { templateId: 't1', siteId: 's1' })).toBeNull()
  })

  it('ignores the same form at another site, which is a different handrail', () => {
    const records = [rec('a', { siteId: 's2' })]
    expect(findLastInspection(records, { templateId: 't1', siteId: 's1' })).toBeNull()
  })

  it('still matches when neither the record nor the task names a site', () => {
    const records = [rec('a', { siteId: '' })]
    expect(findLastInspection(records, { templateId: 't1', siteId: '' })?.id).toBe('a')
    expect(findLastInspection(records, { templateId: 't1' })?.id).toBe('a')
  })

  it('excludes the record being viewed, so it does not compare with itself', () => {
    const records = [rec('a', { completedAt: '2026-01-01T09:00:00.000Z' }), rec('b', { completedAt: '2026-02-01T09:00:00.000Z' })]
    expect(findLastInspection(records, { templateId: 't1', siteId: 's1', excludeId: 'b' }).id).toBe('a')
  })

  it('returns null rather than guessing when there is no history', () => {
    expect(findLastInspection([], { templateId: 't1' })).toBeNull()
    expect(findLastInspection(undefined, { templateId: 't1' })).toBeNull()
    expect(findLastInspection([rec('a')], {})).toBeNull()
  })

  it('does not fall over on a record with an unusable date', () => {
    const records = [rec('a', { completedAt: 'not a date' }), rec('b', { completedAt: '2026-02-01T09:00:00.000Z' })]
    expect(findLastInspection(records, { templateId: 't1', siteId: 's1' }).id).toBe('b')
  })
})

describe('openFindings', () => {
  const FIELDS = [{ id: 'q3' }, { id: 'q1' }, { id: 'q2' }]

  it('returns only the failures — those are the lagging points', () => {
    const r = rec('a', { responses: answers({ q1: 'Pass', q2: 'Fail', q3: 'N/A' }) })
    expect(openFindings(r).map((f) => f.fieldId)).toEqual(['q2'])
  })

  it('reads down the sheet in the form order, not object order', () => {
    const r = rec('a', { responses: answers({ q1: 'Fail', q2: 'Fail', q3: 'Fail' }) })
    expect(openFindings(r, FIELDS).map((f) => f.fieldId)).toEqual(['q3', 'q1', 'q2'])
  })

  it('carries the observation, which is what says what was wrong', () => {
    const r = rec('a', {
      responses: { q1: { label: 'Handrail', answer: 'Fail', observation: '  loose on bay 3  ' } },
    })
    expect(openFindings(r)[0]).toMatchObject({ label: 'Handrail', observation: 'loose on bay 3' })
  })

  it('flags that evidence exists without dragging the image along', () => {
    const r = rec('a', {
      responses: { q1: { label: 'X', answer: 'Fail', photoEvidence: 'data:image/png;base64,AAA' } },
    })
    expect(openFindings(r)[0].hasPhoto).toBe(true)
    expect(openFindings(r)[0].photoEvidence).toBeUndefined()
  })

  it('falls back to the field id when a response has no label', () => {
    const r = rec('a', { responses: { q9: { answer: 'Fail' } } })
    expect(openFindings(r)[0].label).toBe('q9')
  })

  it('is empty for a clean inspection, and for nothing at all', () => {
    expect(openFindings(rec('a', { responses: answers({ q1: 'Pass' }) }))).toEqual([])
    expect(openFindings(null)).toEqual([])
    expect(openFindings({})).toEqual([])
  })
})

describe('previousInspection', () => {
  const records = [
    rec('old', { completedAt: '2026-01-01T09:00:00.000Z', responses: answers({ q1: 'Fail' }) }),
    rec('new', {
      completedAt: '2026-02-01T09:00:00.000Z',
      score: 72,
      passFailResult: 'FAIL',
      docId: 'INSP-ACME_0009',
      inspectorName: 'Priya',
      responses: { q1: { label: 'Handrail', answer: 'Fail', observation: 'loose' }, q2: { label: 'Signage', answer: 'Pass' } },
    }),
  ]

  it('summarises the last run for the header', () => {
    const p = previousInspection(records, { templateId: 't1', siteId: 's1' })
    expect(p).toMatchObject({
      score: 72, result: 'FAIL', docId: 'INSP-ACME_0009', inspector: 'Priya',
      completedAt: '2026-02-01T09:00:00.000Z',
    })
    expect(p.findings).toHaveLength(1)
  })

  it('indexes findings by field so a question can be marked where it is answered', () => {
    const p = previousInspection(records, { templateId: 't1', siteId: 's1' })
    expect(p.byField.get('q1')?.observation).toBe('loose')
    expect(p.byField.has('q2')).toBe(false)
  })

  it('is null when there is no comparable history, so the UI shows nothing', () => {
    expect(previousInspection(records, { templateId: 'other', siteId: 's1' })).toBeNull()
    expect(previousInspection([], { templateId: 't1' })).toBeNull()
  })

  it('reports a clean previous run rather than pretending there was none', () => {
    // "Last inspection found nothing" is information; a blank panel is not.
    const clean = [rec('a', { responses: answers({ q1: 'Pass' }), score: 100, passFailResult: 'PASS' })]
    const p = previousInspection(clean, { templateId: 't1', siteId: 's1' })
    expect(p).not.toBeNull()
    expect(p.findings).toEqual([])
    expect(p.score).toBe(100)
  })
})
