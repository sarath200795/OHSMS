import { describe, it, expect } from 'vitest'
import { isMine, myActions, courseProgress } from './myWork'

const me = { uid: 'u1', name: 'Ravi Kumar', email: 'ravi@acme.test' }

// Owners are free text across the source modules, so this matching is the part
// most able to be quietly wrong — an action attributed to the wrong person is
// invisible to whoever should be doing it.
describe('isMine', () => {
  it('matches on uid, name and email', () => {
    expect(isMine({ owner: 'u1' }, me)).toBe(true)
    expect(isMine({ owner: 'Ravi Kumar' }, me)).toBe(true)
    expect(isMine({ owner: 'ravi@acme.test' }, me)).toBe(true)
  })

  it('ignores case and surrounding space', () => {
    expect(isMine({ owner: '  ravi kumar ' }, me)).toBe(true)
  })

  it('prefers uid when the owner is an object', () => {
    expect(isMine({ owner: { uid: 'u1', name: 'Someone Else' } }, me)).toBe(true)
    expect(isMine({ owner: { uid: 'u2', name: 'Ravi Kumar' } }, me)).toBe(false)
  })

  it('does not match a different person whose name is a prefix', () => {
    expect(isMine({ owner: 'Ravi' }, me)).toBe(false)
    expect(isMine({ owner: 'Ravi Kumaravel' }, me)).toBe(false)
  })

  it('claims nothing when there is no owner or no profile', () => {
    expect(isMine({ owner: '' }, me)).toBe(false)
    expect(isMine({}, me)).toBe(false)
    expect(isMine({ owner: 'Ravi Kumar' }, null)).toBe(false)
  })
})

describe('myActions', () => {
  const rows = [
    { key: 'a', owner: 'Ravi Kumar', due: '2026-09-01', overdue: false },
    { key: 'b', owner: 'Ravi Kumar', due: '2026-06-01', overdue: true },
    { key: 'c', owner: 'Someone Else', due: '2026-05-01', overdue: true },
    { key: 'd', owner: 'u1', due: '', overdue: false },
    { key: 'e', owner: 'Ravi Kumar', due: '2026-08-01', overdue: false },
  ]

  it('keeps only mine', () => {
    expect(myActions(rows, me).map((a) => a.key)).not.toContain('c')
  })

  it('puts overdue first, then earliest due', () => {
    expect(myActions(rows, me).map((a) => a.key)).toEqual(['b', 'e', 'a', 'd'])
  })

  it('sorts undated last rather than first', () => {
    // An empty string would otherwise sort ahead of every real date.
    expect(myActions(rows, me).at(-1).key).toBe('d')
  })
})

describe('courseProgress', () => {
  const courses = [{ id: 'c1', name: 'Working at Height', category: 'Safety' }]

  it('reads an open assignment as 0% and not started', () => {
    const r = courseProgress([{ id: 'a1', courseId: 'c1', employeeUid: 'u1', status: 'assigned', dueDate: '2026-09-01' }], courses, me)
    expect(r[0]).toMatchObject({ pct: 0, done: false, status: 'Due 2026-09-01' })
  })

  it('reads a completed assignment as 100%', () => {
    const r = courseProgress([{ id: 'a1', courseId: 'c1', employeeUid: 'u1', status: 'completed', expiresOn: '2099-01-01' }], courses, me)
    expect(r[0].pct).toBe(100)
    expect(r[0].done).toBe(true)
  })

  it('flags a completed course whose certificate has lapsed', () => {
    // Completed and valid are different things — only the second means the
    // person may do the work today.
    const r = courseProgress([{ id: 'a1', courseId: 'c1', employeeUid: 'u1', status: 'completed', expiresOn: '2020-01-01' }], courses, me)
    expect(r[0].state).toBe('expired')
  })

  it('ignores other people and cancelled assignments', () => {
    const rows = [
      { id: 'a1', courseId: 'c1', employeeUid: 'u2', status: 'assigned' },
      { id: 'a2', courseId: 'c1', employeeUid: 'u1', status: 'cancelled' },
    ]
    expect(courseProgress(rows, courses, me)).toHaveLength(0)
  })

  it('puts outstanding courses before completed ones', () => {
    const rows = [
      { id: 'a1', courseId: 'c1', employeeUid: 'u1', status: 'completed', expiresOn: '2099-01-01' },
      { id: 'a2', courseId: 'c1', employeeUid: 'u1', status: 'assigned', dueDate: '2026-09-01' },
    ]
    expect(courseProgress(rows, courses, me).map((r) => r.id ?? r.key)).toEqual(['a2', 'a1'])
  })

  it('returns nothing without a signed-in uid', () => {
    expect(courseProgress([{ courseId: 'c1', employeeUid: 'u1' }], courses, {})).toEqual([])
  })
})
