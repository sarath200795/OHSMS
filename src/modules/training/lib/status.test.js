import { describe, it, expect } from 'vitest'
import {
  computeExpiry, recordStatus, summarize, latestByEmployeeCourse, buildMatrix,
  assignmentStatus, summarizeAssignments, buildStatusReport, toCsv, REPORT_COLUMNS,
} from './status'

describe('computeExpiry', () => {
  it('adds validity months to the completion date', () => {
    expect(computeExpiry('2026-01-15', 12)).toBe('2027-01-15')
    expect(computeExpiry('2026-03-10', 6)).toBe('2026-09-10')
  })
  it('clamps month-end overflow', () => {
    expect(computeExpiry('2026-01-31', 1)).toBe('2026-02-28')
  })
  it('returns empty when no validity or date', () => {
    expect(computeExpiry('2026-01-15', 0)).toBe('')
    expect(computeExpiry('', 12)).toBe('')
  })
})

describe('recordStatus', () => {
  const today = '2026-07-27'
  it('classifies expired / expiring / valid / none', () => {
    expect(recordStatus('2026-07-26', today)).toBe('expired')
    expect(recordStatus('2026-08-10', today)).toBe('expiring')
    expect(recordStatus('2027-01-01', today)).toBe('valid')
    expect(recordStatus('', today)).toBe('none')
  })
  it('treats the 30-day boundary as expiring', () => {
    expect(recordStatus('2026-08-26', today)).toBe('expiring')
    expect(recordStatus('2026-08-27', today)).toBe('valid')
  })
})

describe('summarize', () => {
  it('counts records per status', () => {
    const s = summarize(
      [{ expiresOn: '2026-01-01' }, { expiresOn: '2099-01-01' }, { expiresOn: '' }],
      '2026-07-27'
    )
    expect(s).toEqual({ total: 3, valid: 1, expiring: 0, expired: 1, none: 1 })
  })
})

describe('assignmentStatus / summarizeAssignments', () => {
  const today = '2026-07-27'
  it('classifies open / due_soon / overdue', () => {
    expect(assignmentStatus('2026-07-26', today)).toBe('overdue')
    expect(assignmentStatus('2026-08-03', today)).toBe('due_soon') // 7-day boundary
    expect(assignmentStatus('2026-08-04', today)).toBe('open')
    expect(assignmentStatus('', today)).toBe('open')
  })
  it('summarizes only open assignments', () => {
    const s = summarizeAssignments(
      [
        { status: 'assigned', dueDate: '2026-07-01' },
        { status: 'assigned', dueDate: '2026-07-30' },
        { status: 'completed', dueDate: '2026-07-01' },
        { status: 'cancelled', dueDate: '2026-07-01' },
      ],
      today
    )
    expect(s).toEqual({ open: 2, due_soon: 1, overdue: 1 })
  })
})

describe('latestByEmployeeCourse / buildMatrix', () => {
  const records = [
    { employeeUid: 'u1', courseId: 'c1', completedOn: '2025-01-01', expiresOn: '2026-01-01' },
    { employeeUid: 'u1', courseId: 'c1', completedOn: '2026-06-01', expiresOn: '2027-06-01' },
    { employeeUid: 'u2', courseId: 'c1', completedOn: '2026-01-01', expiresOn: '2026-08-01' },
  ]
  it('keeps only the latest record per employee+course', () => {
    const map = latestByEmployeeCourse(records)
    expect(map.get('u1:c1').completedOn).toBe('2026-06-01')
    expect(map.size).toBe(2)
  })
  it('builds a matrix with missing cells for untrained employees', () => {
    const rows = buildMatrix(
      [{ uid: 'u1', name: 'A' }, { uid: 'u3', name: 'C' }],
      [{ id: 'c1' }],
      records,
      '2026-07-27'
    )
    expect(rows[0].cells[0].status).toBe('valid')
    expect(rows[1].cells[0].status).toBe('missing')
  })
})

describe('buildStatusReport', () => {
  const users = [{ uid: 'u1', name: 'Priya', email: 'p@t.co', department: 'Safety' }]
  const courses = [
    { id: 'c1', name: 'Fire Safety', category: 'Fire Safety', mandatory: true },
    { id: 'c2', name: 'First Aid', category: 'First Aid', mandatory: false },
  ]
  const records = [{ employeeUid: 'u1', courseId: 'c1', completedOn: '2026-07-10', expiresOn: '2027-07-10' }]
  const assignments = [{ employeeUid: 'u1', courseId: 'c2', status: 'assigned', dueDate: '2026-07-20' }]

  it('covers every employee × course, completed or not', () => {
    const rows = buildStatusReport(users, courses, records, assignments, { from: '2026-07-01', to: '2026-07-27' })
    expect(rows).toHaveLength(2)
    const fire = rows.find((r) => r.course === 'Fire Safety')
    expect(fire.status).toBe('Valid')
    expect(fire.completedOn).toBe('2026-07-10')
    expect(fire.completedInRange).toBe('Yes')
    const aid = rows.find((r) => r.course === 'First Aid')
    expect(aid.status).toBe('Assignment overdue') // due 20 Jul < as-of 27 Jul
    expect(aid.completedInRange).toBe('No')
  })

  it('judges status as of the chosen date (ignores later records)', () => {
    const rows = buildStatusReport(users, courses, records, [], { to: '2026-07-01' })
    const fire = rows.find((r) => r.course === 'Fire Safety')
    expect(fire.status).toBe('Not trained') // completed 10 Jul — after the as-of date
  })

  it('marks expired as of a far-future date', () => {
    const rows = buildStatusReport(users, courses, records, [], { to: '2028-01-01' })
    expect(rows.find((r) => r.course === 'Fire Safety').status).toBe('Expired')
  })
})

describe('toCsv', () => {
  it('serializes with quoting', () => {
    const csv = toCsv(
      [{ employee: 'A, "B"', email: 'a@t.co', department: '', course: 'C', category: '', mandatory: 'No', status: 'Valid', completedOn: '', expiresOn: '', assignmentDue: '', completedInRange: 'No' }],
      REPORT_COLUMNS,
    )
    expect(csv.split('\n')[0]).toContain('Employee,Email')
    expect(csv).toContain('"A, ""B"""')
  })
})
