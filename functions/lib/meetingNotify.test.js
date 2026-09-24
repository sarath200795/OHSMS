import { describe, it, expect } from 'vitest'
import { planMeeting, deliverMeetingMail } from './meetingNotify.js'
import { memoryDb, mailer, user } from '../test-support/memoryDb.js'

const SEALED = 'enk:1:general:wrapped:iviviviviviviviv:ciphertextciphertext'
const APP_PDF = Buffer.from('%PDF-1.4\n% app-meeting-minutes\n')
const APP_PATH = 'orgs/orgA/mailed-reports/ab12cd34-Meeting-Minutes.pdf'

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

  it('attaches the app minutes PDF and still leaves the minutes out of the body', async () => {
    const sent = []
    const calls = []
    await deliverMeetingMail({
      db: db(),
      orgId: 'orgA',
      docId: 'm1',
      before: null,
      after: meeting({ reportPdfPath: APP_PATH }),
      mailer: mailer(sent),
      logger,
      users,
      readObject: async (path) => {
        calls.push(path)
        return APP_PDF
      },
    })
    const file = sent[0].attachments[0]
    expect(file.filename).toBe('Meeting-Minutes-MOM-1.pdf')
    expect(file.content.equals(APP_PDF)).toBe(true)
    expect(calls).toEqual([APP_PATH])
    const body = `${sent[0].subject}\n${sent[0].text}\n${sent[0].html}`
    expect(body).not.toContain('evacuation')
    expect(body).not.toContain('Fix the gate')
    expect(body).not.toContain('Ada')
  })

  it('does not fetch a minutes file when the path is missing or sealed', async () => {
    const sent = []
    const calls = []
    await deliverMeetingMail({
      db: db(),
      orgId: 'orgA',
      docId: 'm1',
      before: null,
      after: meeting({
        subject: SEALED,
        minutes: SEALED,
        reportPdfPath: SEALED,
        attendees: [{ name: SEALED }],
        actions: [{ action: SEALED, owner: SEALED }],
      }),
      mailer: mailer(sent),
      logger,
      users,
      readObject: async (path) => {
        calls.push(path)
        return APP_PDF
      },
    })
    expect(calls).toEqual([])
    expect(sent[0].attachments || []).toEqual([])
    expect(`${sent[0].subject}\n${sent[0].text}`).not.toContain('enk:')
    expect(sent[0].text).toContain('HSE Committee Meeting')
  })

  it('includes a uniquely named or emailed creator, and skips a sealed or shared name', async () => {
    const directory = [
      ...users,
      user('rae', { name: 'Rae Cole' }),
      user('pat1', { name: 'Pat Lee' }),
      user('pat2', { name: 'Pat Lee' }),
    ]
    const sent = []
    const named = await deliverMeetingMail({
      db: db(),
      orgId: 'orgA',
      docId: 'm-rae',
      before: null,
      after: meeting({ createdBy: 'Rae Cole' }),
      mailer: mailer(sent),
      logger,
      users: directory,
    })
    expect(named.sent).toBe(3)
    expect(sent.map((m) => m.to).sort()).toEqual([
      'admin@example.com',
      'entity@example.com',
      'rae@example.com',
    ])

    const mailed = []
    const byEmail = await deliverMeetingMail({
      db: memoryDb(),
      orgId: 'orgA',
      docId: 'm-mail',
      before: null,
      after: meeting({ siteId: '', createdBy: 'rae@example.com' }),
      mailer: mailer(mailed),
      logger,
      users: directory,
    })
    expect(byEmail.sent).toBe(2)
    expect(mailed.map((m) => m.to).sort()).toEqual(['admin@example.com', 'rae@example.com'])

    const sealedSent = []
    await deliverMeetingMail({
      db: db(),
      orgId: 'orgA',
      docId: 'm-seal',
      before: null,
      after: meeting({ createdBy: SEALED }),
      mailer: mailer(sealedSent),
      logger,
      users: directory,
    })
    expect(sealedSent.map((m) => m.to).sort()).toEqual(['admin@example.com', 'entity@example.com'])

    const sharedSent = []
    await deliverMeetingMail({
      db: db(),
      orgId: 'orgA',
      docId: 'm-pat',
      before: null,
      after: meeting({ createdBy: 'Pat Lee' }),
      mailer: mailer(sharedSent),
      logger,
      users: directory,
    })
    expect(sharedSent.map((m) => m.to).sort()).toEqual(['admin@example.com', 'entity@example.com'])
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
