import { describe, it, expect } from 'vitest'
import { planMeeting, deliverMeetingMail } from './meetingNotify.js'
import { memoryDb, mailer, user } from '../test-support/memoryDb.js'

const SEALED = 'enk:1:general:wrapped:iviviviviviviviv:ciphertextciphertext'

function meeting(extra = {}) {
  return {
    subject: 'September review',
    type: 'HSE Committee Meeting',
    date: '2026-09-02',
    time: '10:00',
    minutes: 'Discussed the evacuation.',
    docId: 'MOM-1',
    siteId: 's1',
    attendees: [{ name: 'Ada' }],
    actions: [{ action: 'Fix the gate', owner: 'Ada' }],
    ...extra,
  }
}

describe('planMeeting', () => {
  it('fires when minutes first appear, not on an empty create or a later edit', () => {
    expect(planMeeting(null, meeting({ minutes: '' }))).toBeNull()
    expect(planMeeting(null, meeting()).subject).toBe('September review')
    expect(planMeeting(meeting({ minutes: ' ' }), meeting())).not.toBeNull()
    expect(planMeeting(meeting(), meeting({ minutes: 'A longer write-up.' }))).toBeNull()
  })

  it('marks a meeting with no site as org-wide', () => {
    expect(planMeeting(null, meeting({ siteId: '' })).orgWide).toBe(true)
  })
})

describe('deliverMeetingMail', () => {
  const logger = { info() {}, error() {} }
  const users = [
    user('admin', { role: 'admin' }),
    user('entity', { access: { entities: ['COCO'] } }),
    user('manager', { role: 'manager' }),
    user('member', { siteId: 's9' }),
  ]

  function db() {
    return memoryDb({
      'organizations/orgA/sites/s1': { name: 'Plant 2', region: 'South', entity: 'COCO' },
    })
  }

  it('mails the scoped audience once and never copies minutes or a sealed subject', async () => {
    const sent = []
    const store = db()
    const after = meeting({ subject: SEALED, minutes: `${SEALED} Ada spoke` })
    const args = {
      db: store,
      orgId: 'orgA',
      docId: 'm1',
      before: null,
      after,
      mailer: mailer(sent),
      logger,
      users,
    }
    expect((await deliverMeetingMail(args)).sent).toBe(2)
    expect(sent.map((m) => m.to).sort()).toEqual(['admin@example.com', 'entity@example.com'])
    const blob = sent.map((m) => `${m.subject}\n${m.text}\n${m.html}`).join('\n')
    expect(blob).toContain('Committee meeting: HSE Committee Meeting')
    expect(blob).toContain('Sealed — open the record in the app')
    expect(blob).toContain('Plant 2')
    expect(blob).toContain('https://suite.weehs.org/committee')
    expect(blob).not.toContain('enk:')
    expect(blob).not.toContain('Ada')
    expect(blob).not.toContain('evacuation')
    expect(blob).not.toContain('Fix the gate')
    expect((await deliverMeetingMail(args)).skipped).toBe(2)
  })

  it('gives an org-wide meeting to admins only', async () => {
    const sent = []
    const result = await deliverMeetingMail({
      db: memoryDb(),
      orgId: 'orgA',
      docId: 'm2',
      before: null,
      after: meeting({ siteId: '' }),
      mailer: mailer(sent),
      logger,
      users,
    })
    expect(result.sent).toBe(1)
    expect(sent[0].to).toBe('admin@example.com')
    expect(sent[0].text).toContain('Organisation-wide')
  })

  it('attaches the minutes when they are plaintext and still leaves them out of the body', async () => {
    const sent = []
    await deliverMeetingMail({
      db: db(),
      orgId: 'orgA',
      docId: 'm1',
      before: null,
      after: meeting(),
      mailer: mailer(sent),
      logger,
      users,
    })
    const file = sent[0].attachments[0]
    expect(file.filename).toBe('Meeting-Minutes-MOM-1.pdf')
    const pdf = file.content.toString('latin1')
    expect(pdf).toContain('Discussed the evacuation.')
    expect(pdf).toContain('Fix the gate')
    expect(pdf).toContain('Ada')
    const body = `${sent[0].subject}\n${sent[0].text}\n${sent[0].html}`
    expect(body).not.toContain('evacuation')
    expect(body).not.toContain('Fix the gate')
    expect(body).not.toContain('Ada')
  })

  it('does not put a sealed minutes envelope into the MOM file', async () => {
    const sent = []
    await deliverMeetingMail({
      db: db(),
      orgId: 'orgA',
      docId: 'm1',
      before: null,
      after: meeting({
        subject: SEALED,
        minutes: SEALED,
        attendees: [{ name: SEALED }],
        actions: [{ action: SEALED, owner: SEALED }],
      }),
      mailer: mailer(sent),
      logger,
      users,
    })
    const pdf = sent[0].attachments[0].content.toString('latin1')
    expect(sent[0].attachments[0].filename).toBe('Meeting-Minutes-MOM-1.pdf')
    expect(pdf).not.toContain('enk:')
    expect(pdf).toContain('Sealed')
    expect(pdf).toContain('HSE Committee Meeting')
    expect(`${sent[0].subject}\n${sent[0].text}`).not.toContain('enk:')
  })

  it('does not claim when mail is not configured', async () => {
    const store = db()
    const result = await deliverMeetingMail({
      db: store,
      orgId: 'orgA',
      docId: 'm1',
      before: null,
      after: meeting(),
      mailer: mailer([], { pass: '' }),
      logger,
      users,
    })
    expect(result.reason).toBe('not-configured')
    expect(store.notifications()).toHaveLength(0)
  })
})
