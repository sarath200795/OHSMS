import { describe, it, expect } from 'vitest'
import {
  sessionProblems, isSessionValid, sessionState, canRequest, sortSessions,
  countRequests, countRequestsByCourse, myRequest, sessionWhere, isClassroom,
} from './sessions'

const TODAY = '2026-07-31'
const SITES = [{ id: 's1', name: 'Plant 2' }]

const online = (p = {}) => ({ mode: 'online', meetingLink: 'https://meet.example/abc', validFrom: '2026-07-01', validTo: '2026-08-31', ...p })
const offline = (p = {}) => ({ mode: 'offline', siteId: 's1', validFrom: '2026-07-01', validTo: '2026-08-31', ...p })

describe('sessionProblems', () => {
  it('accepts a complete online session', () => {
    expect(sessionProblems(online())).toEqual([])
    expect(isSessionValid(online())).toBe(true)
  })

  it('accepts a complete in-person session', () => {
    expect(sessionProblems(offline())).toEqual([])
  })

  it('insists an online session has somewhere to join', () => {
    // Without it the session is an announcement, not something anyone attends.
    expect(sessionProblems(online({ meetingLink: '' }))).toContain('Add the meeting link')
  })

  it('insists an in-person session has somewhere to be', () => {
    expect(sessionProblems(offline({ siteId: '' }))).toContain('Pick the site it runs at')
  })

  it('requires both dates', () => {
    expect(sessionProblems(online({ validFrom: '' }))).toContain('Pick the date it starts')
    expect(sessionProblems(online({ validTo: '' }))).toContain('Pick the date it ends')
  })

  it('rejects a window that ends before it starts', () => {
    expect(sessionProblems(online({ validFrom: '2026-09-01', validTo: '2026-08-01' })))
      .toContain('The end date is before the start date')
  })

  it('does not ask an online session for a site, or the reverse', () => {
    expect(sessionProblems(online({ siteId: '' }))).toEqual([])
    expect(sessionProblems(offline({ meetingLink: '' }))).toEqual([])
  })
})

describe('sessionState', () => {
  it('reads the window against today', () => {
    expect(sessionState(online(), TODAY)).toBe('open')
    expect(sessionState(online({ validFrom: '2026-09-01', validTo: '2026-09-30' }), TODAY)).toBe('upcoming')
    expect(sessionState(online({ validFrom: '2026-05-01', validTo: '2026-06-30' }), TODAY)).toBe('closed')
  })

  it('includes both end dates', () => {
    expect(sessionState(online({ validFrom: TODAY, validTo: TODAY }), TODAY)).toBe('open')
  })

  it('lets someone request an upcoming session but not a finished one', () => {
    expect(canRequest(online({ validFrom: '2026-09-01', validTo: '2026-09-30' }), TODAY)).toBe(true)
    expect(canRequest(online({ validFrom: '2026-01-01', validTo: '2026-02-01' }), TODAY)).toBe(false)
  })
})

describe('sortSessions', () => {
  it('puts open first, then upcoming, then finished', () => {
    // Finished ones stay visible: an employee should see the session ran.
    const rows = [
      { id: 'past', ...online({ validFrom: '2026-01-01', validTo: '2026-02-01' }) },
      { id: 'later', ...online({ validFrom: '2026-09-01', validTo: '2026-09-30' }) },
      { id: 'now', ...online() },
    ]
    expect(sortSessions(rows, TODAY).map((s) => s.id)).toEqual(['now', 'later', 'past'])
  })

  it('orders same-state sessions by start date', () => {
    const rows = [
      { id: 'b', ...online({ validFrom: '2026-10-01', validTo: '2026-10-05' }) },
      { id: 'a', ...online({ validFrom: '2026-09-01', validTo: '2026-09-05' }) },
    ]
    expect(sortSessions(rows, TODAY).map((s) => s.id)).toEqual(['a', 'b'])
  })
})

describe('counting requests', () => {
  const reqs = [
    { sessionId: 'x', courseId: 'c1', employeeUid: 'u1', status: 'pending' },
    { sessionId: 'x', courseId: 'c1', employeeUid: 'u2', status: 'approved' },
    { sessionId: 'y', courseId: 'c1', employeeUid: 'u1', status: 'pending' },
    { sessionId: 'y', courseId: 'c2', employeeUid: 'u3', status: 'declined' },
  ]

  it('groups by session', () => {
    const m = countRequests(reqs)
    expect(m.get('x')).toMatchObject({ total: 2, pending: 1, approved: 1 })
    expect(m.get('y')).toMatchObject({ total: 2, pending: 1, declined: 1 })
  })

  it('groups by course, which is what tells an admin whether to run it', () => {
    const m = countRequestsByCourse(reqs)
    expect(m.get('c1')).toMatchObject({ total: 3, pending: 2, approved: 1 })
    expect(m.get('c2')).toMatchObject({ total: 1, declined: 1 })
  })

  it('treats an unknown status as pending rather than dropping it', () => {
    const m = countRequests([{ sessionId: 'x', status: 'weird' }])
    expect(m.get('x')).toMatchObject({ total: 1, pending: 1 })
  })

  it('ignores rows with nothing to group on', () => {
    expect(countRequests([{ status: 'pending' }]).size).toBe(0)
  })

  it('finds one person’s request for a session', () => {
    expect(myRequest(reqs, 'x', 'u2')).toMatchObject({ status: 'approved' })
    expect(myRequest(reqs, 'x', 'u9')).toBeNull()
  })
})

describe('sessionWhere', () => {
  it('names the site for an in-person session', () => {
    expect(sessionWhere(offline(), SITES)).toBe('Plant 2')
    expect(sessionWhere(offline({ room: 'Training Room 1' }), SITES)).toBe('Plant 2 · Training Room 1')
  })

  it('says online, and admits when the link is missing', () => {
    expect(sessionWhere(online(), SITES)).toBe('Online')
    expect(sessionWhere(online({ meetingLink: '' }), SITES)).toBe('Online — link to follow')
  })
})

describe('isClassroom', () => {
  it('is true only for the classroom delivery mode', () => {
    expect(isClassroom({ deliveryMode: 'classroom' })).toBe(true)
    expect(isClassroom({ deliveryMode: 'module' })).toBe(false)
    // Courses created before delivery mode existed are module-based.
    expect(isClassroom({})).toBe(false)
  })
})
