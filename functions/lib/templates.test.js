import { describe, it, expect } from 'vitest'
import {
  actionAssigned,
  permitExpiring,
  trainingExpiring,
  incidentReported,
  unsafeObservation,
  digest,
  fmtDate,
  relativeDays,
  daysBetween,
  plural,
} from './templates.js'

const NOW = '2026-08-06'
const BASE = 'https://weehs-4eb28.web.app'

describe('helpers', () => {
  it('formats dates unambiguously', () => {
    expect(fmtDate('2026-08-12')).toBe('12 Aug 2026')
    expect(fmtDate(null)).toBe('—')
    expect(fmtDate('not a date')).toBe('not a date')
  })

  it('handles a Firestore Timestamp', () => {
    expect(fmtDate({ toDate: () => new Date('2026-08-12T00:00:00Z') })).toBe('12 Aug 2026')
  })

  it('says today/tomorrow rather than "in 0 days"', () => {
    expect(relativeDays(0)).toBe('today')
    expect(relativeDays(1)).toBe('tomorrow')
    expect(relativeDays(-1)).toBe('yesterday')
    expect(relativeDays(5)).toBe('in 5 days')
    expect(relativeDays(-5)).toBe('5 days ago')
  })

  it('counts calendar days, not elapsed hours', () => {
    expect(daysBetween('2026-08-06T23:00:00', '2026-08-07T01:00:00')).toBe(1)
    expect(daysBetween('2026-08-06', '2026-08-06')).toBe(0)
    expect(daysBetween('bad', '2026-08-06')).toBeNull()
  })

  it('pluralises', () => {
    expect(plural(1, 'item')).toBe('1 item')
    expect(plural(3, 'item')).toBe('3 items')
    expect(plural(2, 'entry', 'entries')).toBe('2 entries')
  })
})

describe('actionAssigned', () => {
  const action = { title: 'Replace cracked hose', dueDate: '2026-08-20', site: 'Hosur', priority: 'High' }

  it('leads with the action in the subject', () => {
    expect(actionAssigned(action, { now: NOW }).subject).toBe('Action assigned to you: Replace cracked hose')
  })

  it('marks imminent and overdue work in the subject', () => {
    expect(actionAssigned({ ...action, dueDate: '2026-08-07' }, { now: NOW }).subject).toContain('(due tomorrow)')
    expect(actionAssigned({ ...action, dueDate: '2026-08-01' }, { now: NOW }).subject).toContain('(overdue)')
  })

  it('includes the link only when a base URL is configured', () => {
    expect(actionAssigned(action, { baseUrl: BASE, now: NOW }).text).toContain(`${BASE}/actions`)
    expect(actionAssigned(action, { now: NOW }).html).not.toContain('href')
  })

  it('falls back through title → description → Untitled', () => {
    expect(actionAssigned({ description: 'Fix it' }, {}).subject).toContain('Fix it')
    expect(actionAssigned({}, {}).subject).toContain('Untitled')
  })
})

describe('permitExpiring', () => {
  const permit = { docId: 'PTW-HOSUR-1042', title: 'Hot work at bay 3', permitType: 'Hot Work', site: 'Hosur', validTo: '2026-08-08', requestedBy: 'Ravi' }

  it('puts the deadline in the subject', () => {
    expect(permitExpiring(permit, { now: NOW }).subject).toBe('Permit PTW-HOSUR-1042 expires in 2 days')
  })

  it('carries the identifying detail a reader needs to act', () => {
    const { text } = permitExpiring(permit, { now: NOW })
    expect(text).toContain('PTW-HOSUR-1042')
    expect(text).toContain('Hot work at bay 3')
    expect(text).toContain('Hosur')
    expect(text).toContain('8 Aug 2026')
  })
})

describe('trainingExpiring', () => {
  it('names the employee and the course', () => {
    const out = trainingExpiring(
      { title: 'Working at Height', employee: 'Priya S', expiryDate: '2026-09-05', completedDate: '2025-09-05' },
      { now: NOW }
    )
    expect(out.subject).toContain('Working at Height')
    expect(out.text).toContain('Priya S')
    expect(out.text).toContain('5 Sep 2026')
  })
})

describe('incidentReported', () => {
  const incident = { refNo: 'INC-2026-014', type: 'Near miss', severity: 'High', incidentDate: '2026-08-05', lifecycle: 'reported' }

  it('front-loads severity so a triage rule can act on the subject', () => {
    expect(incidentReported(incident, {}).subject).toBe('[High] Incident reported: INC-2026-014')
  })

  it('reads sensibly with severity missing', () => {
    const { subject, text } = incidentReported({ refNo: 'INC-1' }, {})
    expect(subject).toBe('Incident reported: INC-1')
    expect(text).not.toContain('undefined')
  })

  it('names the site when one is resolved', () => {
    expect(incidentReported(incident, { siteName: 'Hosur' }).text).toContain('Hosur')
  })
})

describe('unsafeObservation', () => {
  it('explains that the reporter may be anonymous', () => {
    const out = unsafeObservation(
      { permitNo: 'PTW-HOSUR-1042', note: 'No fire watch present', source: 'public' },
      { permit: { title: 'Hot work', site: 'Hosur' } }
    )
    expect(out.subject).toContain('PTW-HOSUR-1042')
    expect(out.text).toContain('No fire watch present')
    expect(out.text).toContain('public QR scan')
    expect(out.html).toContain('may not have an account')
  })
})

describe('digest', () => {
  const payload = {
    permits: [{ docId: 'PTW-1', validTo: '2026-08-08' }],
    training: [{ employee: 'Priya S', title: 'First Aid', expiryDate: '2026-08-10' }],
    actions: [{ title: 'Replace hose', dueDate: '2026-08-07' }],
  }

  it('summarises across modules', () => {
    const out = digest(payload, { orgName: 'Acme', now: NOW })
    expect(out.subject).toBe('OHS digest — 3 items need attention')
    expect(out.text).toContain('PTW-1')
    expect(out.text).toContain('First Aid')
    expect(out.text).toContain('due tomorrow')
  })

  // An empty digest every morning trains people to filter the whole sender.
  it('returns null when there is nothing to report', () => {
    expect(digest({ permits: [], training: [], actions: [] }, { now: NOW })).toBeNull()
    expect(digest({}, { now: NOW })).toBeNull()
  })

  it('omits sections that are empty rather than printing a zero', () => {
    const out = digest({ permits: payload.permits }, { now: NOW })
    expect(out.text).toContain('Permits')
    expect(out.text).not.toContain('Training')
  })

  // The only opt-out the mail tier honours is notificationsEnabled on the user
  // record, and no screen in the app writes it. The footer has to name the route
  // that exists rather than one the reader would go looking for and never find.
  it('points the opt-out at an administrator, not at a profile screen', () => {
    const out = digest(payload, { orgName: 'Acme', now: NOW })
    expect(out.html).toContain('ask your OHS administrator')
    expect(out.html).not.toMatch(/profile/i)
  })
})

describe('escaping', () => {
  // Notes and titles are user input and land in an HTML email.
  it('escapes markup from record content', () => {
    const out = unsafeObservation({ permitNo: 'P1', note: '<img src=x onerror=alert(1)>' }, {})
    expect(out.html).not.toContain('<img')
    expect(out.html).toContain('&lt;img')
  })

  it('keeps the plain-text part free of tags', () => {
    const out = actionAssigned({ title: '<b>bold</b> job' }, { baseUrl: BASE })
    expect(out.text).not.toContain('<b>')
  })

  // Escaping for HTML and then reusing the escaped string as text is the classic
  // way apostrophes reach a reader as "Ravi&#39;s permit".
  it('never leaks HTML entities into the plain-text part', () => {
    const out = permitExpiring(
      { docId: 'PTW-1', title: "Ravi's hot work & welding", validTo: '2026-08-08' },
      { now: NOW }
    )
    expect(out.text).toContain("Ravi's hot work & welding")
    expect(out.text).not.toMatch(/&#39;|&amp;|&quot;/)
  })

  it('still escapes those same characters in the HTML part', () => {
    const out = permitExpiring({ docId: 'PTW-1', title: "Ravi's & co", validTo: '2026-08-08' }, { now: NOW })
    expect(out.html).toContain('&#39;')
    expect(out.html).toContain('&amp;')
  })
})
