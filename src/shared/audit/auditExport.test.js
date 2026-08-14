import { describe, it, expect } from 'vitest'
import { atMillis, isoAt, auditRows, auditExportSummary } from './auditExport'

const NOW = Date.parse('2026-03-14T09:15:00.000Z')

describe('reading the timestamp, whatever shape it arrived in', () => {
  it('handles a Firestore Timestamp, a Date and an ISO string', () => {
    expect(atMillis({ toMillis: () => NOW })).toBe(NOW)
    expect(atMillis({ seconds: NOW / 1000, nanoseconds: 0 })).toBe(NOW)
    expect(atMillis(new Date(NOW))).toBe(NOW)
    expect(atMillis('2026-03-14T09:15:00.000Z')).toBe(NOW)
  })

  it('returns nothing for what it cannot read, rather than a wrong date', () => {
    expect(atMillis(null)).toBeNull()
    expect(atMillis('not a date')).toBeNull()
    expect(isoAt(null)).toBe('')
  })

  // A locale-formatted time is ambiguous the moment the file crosses a
  // timezone, and a trail whose times are ambiguous cannot establish an order
  // of events — the only thing anyone reads it for.
  it('writes UTC ISO 8601, not a locale string', () => {
    expect(isoAt(new Date(NOW))).toBe('2026-03-14T09:15:00.000Z')
  })
})

describe('a row of evidence', () => {
  const log = {
    id: 'log1',
    at: new Date(NOW),
    action: 'record.close',
    module: 'incidents',
    actorName: 'R. Osei',
    actorUid: 'uid-9',
    targetLabel: 'INC-2026-0007',
    targetId: 'i1',
    details: { field: 'status', to: 'closed' },
  }

  it('carries when, what, who and which', () => {
    const r = auditRows([log])[0]
    expect(r['When (UTC)']).toBe('2026-03-14T09:15:00.000Z')
    expect(r.Module).toBe('incidents')
    expect(r.Target).toBe('INC-2026-0007')
    expect(r['Entry id']).toBe('log1')
  })

  // The name is what a reader recognises; the uid is the fact, and the one the
  // rules pin. A row carrying only the name would reproduce exactly the
  // ambiguity the trail exists to remove.
  it('carries BOTH the actor name and the uid', () => {
    const r = auditRows([log])[0]
    expect(r['Actor name']).toBe('R. Osei')
    expect(r['Actor uid']).toBe('uid-9')
  })

  it('keeps the raw action key beside its label, so a filter can be rebuilt', () => {
    const r = auditRows([log])[0]
    expect(r['Action key']).toBe('record.close')
    expect(r.Action).toBeTruthy()
  })

  it('serialises structured details rather than writing [object Object]', () => {
    expect(auditRows([log])[0].Details).toContain('closed')
    expect(auditRows([{ ...log, details: 'plain text' }])[0].Details).toBe('plain text')
  })

  it('writes blanks, never undefined, for an entry missing fields', () => {
    const r = auditRows([{ id: 'x' }])[0]
    expect(Object.values(r).every((v) => v !== undefined && v !== null)).toBe(true)
    expect(r['When (UTC)']).toBe('')
  })

  it('survives junk', () => {
    expect(auditRows()).toEqual([])
    expect(auditRows([null])).toEqual([])
  })
})

// An exported range with no statement of its bounds is indistinguishable from a
// complete record, and somebody will eventually read one as the other.
describe('the header that says what the file is', () => {
  it('states the range, the count and when it was taken', () => {
    const rows = Object.fromEntries(auditExportSummary({
      orgName: 'Acme', from: '2026-03-01', to: '2026-03-31', count: 42,
    }))
    expect(rows.Organization).toBe('Acme')
    expect(rows['Range from']).toBe('2026-03-01')
    expect(rows['Range to']).toBe('2026-03-31')
    expect(rows['Entries in this file']).toBe('42')
    expect(rows['Exported at (UTC)']).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('says plainly when the range was open-ended', () => {
    const rows = Object.fromEntries(auditExportSummary({ count: 0 }))
    expect(rows['Range from']).toMatch(/earliest/i)
    expect(rows['Range to']).toMatch(/latest/i)
  })

  // In the file, not in a toast that disappeared.
  it('warns IN THE FILE when the query hit its ceiling', () => {
    const capped = Object.fromEntries(auditExportSummary({ count: 5000, capped: true }))
    expect(capped['Complete for the range']).toMatch(/^NO/)
    expect(capped['Complete for the range']).toMatch(/narrow the range/i)
    const whole = Object.fromEntries(auditExportSummary({ count: 12 }))
    expect(whole['Complete for the range']).toBe('yes')
  })
})
