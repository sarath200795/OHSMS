// ─────────────────────────────────────────────────────────────────────────────
// Classroom sessions — pure domain logic, no Firestore.
//
// A course is delivered one of two ways. Module-based training is self-paced:
// an employee opens the material and completes it whenever. A classroom session
// happens at a time and a place, which is why only this kind carries dates, a
// meeting link or a site, and a request queue — you cannot ask to attend
// something that is always open.
// ─────────────────────────────────────────────────────────────────────────────

export const DELIVERY_MODES = [
  { key: 'module', label: 'Module-based', hint: 'Self-paced material an employee completes on their own.' },
  { key: 'classroom', label: 'Classroom session', hint: 'Runs at a set time, online or at a site.' },
]
export const DELIVERY_KEYS = DELIVERY_MODES.map((d) => d.key)
export const isClassroom = (course) => course?.deliveryMode === 'classroom'

export const SESSION_MODES = [
  { key: 'online', label: 'Online' },
  { key: 'offline', label: 'In person' },
]

export const REQUEST_STATUS = [
  { key: 'pending', label: 'Pending', color: '#f59e0b' },
  { key: 'approved', label: 'Approved', color: '#22c55e' },
  { key: 'declined', label: 'Declined', color: '#ef4444' },
]

export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * What is wrong with a session, as a list of reasons.
 *
 * An online session needs somewhere to join and an in-person one needs
 * somewhere to be; a session with neither is an announcement, not something an
 * employee can attend.
 */
export function sessionProblems(s = {}) {
  const out = []
  if (!String(s.validFrom || '').trim()) out.push('Pick the date it starts')
  if (!String(s.validTo || '').trim()) out.push('Pick the date it ends')
  if (s.validFrom && s.validTo && s.validTo < s.validFrom) out.push('The end date is before the start date')
  if (s.mode === 'online' && !String(s.meetingLink || '').trim()) out.push('Add the meeting link')
  if (s.mode === 'offline' && !String(s.siteId || '').trim()) out.push('Pick the site it runs at')
  return out
}

export const isSessionValid = (s) => sessionProblems(s).length === 0

/**
 * 'upcoming' | 'open' | 'closed' — where today sits against the window.
 *
 * Closed is deliberately not the same as "cancelled": a session that has run
 * still matters, because the people who attended it hold a completion against
 * it and the record has to stay readable.
 */
export function sessionState(s, today = todayISO()) {
  if (!s?.validFrom || !s?.validTo) return 'upcoming'
  if (today < s.validFrom) return 'upcoming'
  if (today > s.validTo) return 'closed'
  return 'open'
}

/** Can this person still ask for a place? */
export function canRequest(session, today = todayISO()) {
  return sessionState(session, today) !== 'closed'
}

/**
 * Sessions for a course, soonest first.
 *
 * Closed ones sort last rather than being dropped — an employee looking at a
 * course should be able to see it ran, even if they cannot now join it.
 */
export function sortSessions(sessions = [], today = todayISO()) {
  const rank = { open: 0, upcoming: 1, closed: 2 }
  return [...sessions].sort((a, b) => {
    const ra = rank[sessionState(a, today)]
    const rb = rank[sessionState(b, today)]
    if (ra !== rb) return ra - rb
    return String(a.validFrom || '') < String(b.validFrom || '') ? -1 : 1
  })
}

/** Requests grouped by the session they are for. */
export function countRequests(requests = []) {
  const m = new Map()
  for (const r of requests) {
    if (!r?.sessionId) continue
    const c = m.get(r.sessionId) || { total: 0, pending: 0, approved: 0, declined: 0 }
    c.total += 1
    const s = REQUEST_STATUS.some((x) => x.key === r.status) ? r.status : 'pending'
    c[s] += 1
    m.set(r.sessionId, c)
  }
  return m
}

/** Requests grouped by course, for the admin's "who wants this" figure. */
export function countRequestsByCourse(requests = []) {
  const m = new Map()
  for (const r of requests) {
    if (!r?.courseId) continue
    const c = m.get(r.courseId) || { total: 0, pending: 0, approved: 0, declined: 0 }
    c.total += 1
    const s = REQUEST_STATUS.some((x) => x.key === r.status) ? r.status : 'pending'
    c[s] += 1
    m.set(r.courseId, c)
  }
  return m
}

/** This person's request for a session, if they have one. */
export function myRequest(requests = [], sessionId, uid) {
  return requests.find((r) => r.sessionId === sessionId && r.employeeUid === uid) || null
}

/** Where a session takes place, as one readable line. */
export function sessionWhere(session, sites = []) {
  if (!session) return ''
  if (session.mode === 'online') return session.meetingLink ? 'Online' : 'Online — link to follow'
  const site = sites.find((s) => s.id === session.siteId)
  return [site?.name || session.siteName || 'In person', session.room].filter(Boolean).join(' · ')
}
