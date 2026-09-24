import { describe, it, expect } from 'vitest'
import {
  planPermitEvents,
  recipientsForPermitEvent,
  deliverPermitMails,
  matchPermitSite,
} from './permitNotify.js'
import { memoryDb, mailer, user } from '../test-support/memoryDb.js'

const APP_PDF = Buffer.from('%PDF-1.4\n% app-permit-to-work\n')
const APP_PATH = 'orgs/orgA/mailed-reports/ab12cd34-Permit-to-Work.pdf'

const pending = { status: 'pending' }
const approved = (by, at = '2026-09-01T10:00:00.000Z') => ({
  status: 'approved',
  by,
  at,
  byName: '',
  note: '',
})
const rejected = (by, at = '2026-09-01T11:00:00.000Z') => ({
  status: 'rejected',
  by,
  at,
  byName: '',
  note: '',
})

function permit(extra = {}) {
  return {
    permitNo: 'PTW-2026-0007',
    typeOfWork: 'Hot work',
    site: 'Plant 2',
    siteId: 's1',
    jobLocation: 'Roof',
    jobDescription: 'Do not mail this narrative',
    participants: [{ type: 'internal', name: 'Worker Wren', contact: '999' }],
    issuedToName: 'Receiver Ray',
    createdBy: 'raiser',
    assignedEngineer: 'eng',
    assignedOperator: 'ops',
    engineering: pending,
    operations: pending,
    ...extra,
  }
}

const SITES = [{ id: 's1', name: 'Plant 2', region: 'South', entity: 'COCO' }]

function users() {
  return [
    user('raiser', { role: 'member' }),
    user('eng', { role: 'engineering' }),
    user('ops', { role: 'operations' }),
    user('boss', { role: 'manager', access: { sites: ['s1'] } }),
    user('far', { role: 'manager', access: { sites: ['s9'] } }),
    user('blank', { role: 'manager', access: { regions: [''] } }),
    user('member', { role: 'member', siteId: 's1' }),
    user('admin', { role: 'admin' }),
  ]
}

describe('planPermitEvents', () => {
  it('treats a create as raised, and a later status-only write as nothing', () => {
    expect(planPermitEvents(null, permit()).map((e) => e.name)).toEqual(['raised'])
    const decided = permit({
      engineering: approved('eng'),
      operations: approved('ops'),
      storedStatus: 'in_progress',
    })
    const reconciled = { ...decided, storedStatus: 'not_closed' }
    expect(planPermitEvents(decided, reconciled)).toEqual([])
  })

  it('sends issued when the second team approves, not a second single-team approval', () => {
    const before = permit({ engineering: approved('eng') })
    const after = permit({
      engineering: approved('eng'),
      operations: approved('ops', '2026-09-01T12:00:00.000Z'),
    })
    const events = planPermitEvents(before, after)
    expect(events.map((e) => e.name)).toEqual(['issued'])
    expect(events[0].actorUid).toBe('ops')
    expect(events[0].token).toBe('issued')
  })

  it('names a rejection, a closure request and a non-compliance close', () => {
    const raised = permit()
    const no = permit({ engineering: rejected('eng') })
    expect(planPermitEvents(raised, no).map((e) => e.token)).toEqual([
      'rejected:engineering:2026-09-01T11:00:00.000Z',
    ])
    const closure = permit({
      engineering: approved('eng'),
      operations: approved('ops'),
      closure: {
        requestedBy: 'raiser',
        requestedAt: '2026-09-02T01:00:00.000Z',
        engineering: pending,
        operations: pending,
      },
    })
    expect(planPermitEvents({ ...closure, closure: null }, closure)[0].name).toBe(
      'closure_requested'
    )
    const shut = permit({
      closedDueToObservation: { by: 'admin', at: '2026-09-03T00:00:00.000Z', note: 'unsafe' },
    })
    expect(planPermitEvents(permit(), shut)[0].name).toBe('closed_noncompliance')
  })

  it('does not mail a deleted permit', () => {
    expect(planPermitEvents(null, permit({ deletedAt: '2026-09-01' }))).toEqual([])
  })
})

describe('permit recipients', () => {
  function uids(event, row, directory = users(), sites = SITES) {
    return recipientsForPermitEvent(event, row, directory, sites, 'orgA').recipients.map(
      (r) => r.uid
    )
  }

  it('mails the raiser, internal personnel, and the named engineering and ops contacts', () => {
    const row = permit({
      participants: [
        { type: 'internal', name: 'Worker Wren' },
        { type: 'external', name: 'Worker Wren', contact: 'outsider@example.com' },
      ],
    })
    const event = planPermitEvents(null, row)[0]
    expect(event.actorUid).toBe('raiser')
    const directory = [
      ...users(),
      user('wren', { name: 'Worker Wren', role: 'member' }),
      user('admin', { role: 'admin' }),
      user('posted', { siteId: 's1', role: 'member' }),
    ]
    // The raiser is the actor and is still included. A site posting is too.
    // The external row is the same display name and is not a second person.
    // eng and ops are named and have no grant; they are not dropped for that.
    expect(uids(event, row, directory).sort()).toEqual([
      'admin',
      'boss',
      'eng',
      'member',
      'ops',
      'posted',
      'raiser',
      'wren',
    ])
  })

  it('drops engineering or ops when that contact was left as the whole team', () => {
    const row = permit({ assignedEngineer: null, assignedOperator: '' })
    const event = planPermitEvents(null, row)[0]
    expect(uids(event, row).sort()).toEqual(['admin', 'boss', 'member', 'raiser'])
  })

  it('includes the raiser on a later event, and does not mail an actor the site does not reach', () => {
    const before = permit({ engineering: approved('eng') })
    const after = permit({
      engineering: approved('eng'),
      operations: approved('far', '2026-09-01T12:00:00.000Z'),
      assignedEngineer: 'eng',
      assignedOperator: null,
    })
    const event = planPermitEvents(before, after)[0]
    expect(event.name).toBe('issued')
    expect(event.actorUid).toBe('far')
    const got = uids(event, after)
    expect(got).not.toContain('far')
    expect(got.sort()).toEqual(['admin', 'boss', 'eng', 'member', 'raiser'])
  })

  it('keeps the raiser once, first, and collapses a shared mailbox', () => {
    const row = permit()
    const event = planPermitEvents(null, row)[0]
    const { recipients } = recipientsForPermitEvent(event, row, users(), SITES, 'orgA')
    expect(recipients[0].uid).toBe('raiser')
    expect(recipients.filter((r) => r.uid === 'raiser')).toHaveLength(1)

    const shared = users().map((person) =>
      person.uid === 'raiser' || person.uid === 'eng'
        ? { ...person, email: 'shared@example.com' }
        : person
    )
    const collapsed = recipientsForPermitEvent(event, row, shared, SITES, 'orgA').recipients
    expect(collapsed.filter((r) => r.email === 'shared@example.com')).toHaveLength(1)
    expect(collapsed[0].email).toBe('shared@example.com')
  })

  it('does not mail a raiser with no usable address, or an ambiguous internal name', () => {
    const row = permit({
      participants: [{ type: 'internal', name: 'Pat Lee' }],
    })
    const event = planPermitEvents(null, row)[0]
    const pending = users().map((person) =>
      person.uid === 'raiser' ? { ...person, status: 'pending' } : person
    )
    expect(uids(event, row, pending)).not.toContain('raiser')
    const twins = [...users(), user('pat1', { name: 'Pat Lee' }), user('pat2', { name: 'Pat Lee' })]
    const got = uids(event, row, twins)
    expect(got).not.toContain('pat1')
    expect(got).not.toContain('pat2')
  })

  it('does not treat an empty-string region grant as a recipient', () => {
    const open = permit({
      assignedEngineer: null,
      assignedOperator: null,
      site: 'Mystery',
      siteId: '',
    })
    const event = planPermitEvents(null, open)[0]
    const sites = [{ id: 's2', name: 'Other', region: '', entity: '' }]
    expect(matchPermitSite(open, sites)).toBeNull()
    expect(uids(event, open, users(), sites).sort()).toEqual(['admin', 'raiser'])
    expect(uids(event, open, users(), sites)).not.toContain('blank')
  })
})

describe('deliverPermitMails', () => {
  const logger = { info() {}, error() {} }

  it('sends once per recipient and a retry does not send again', async () => {
    const sent = []
    const db = memoryDb()
    const args = {
      db,
      orgId: 'orgA',
      docId: 'p1',
      before: null,
      after: permit(),
      mailer: mailer(sent),
      logger,
      users: users(),
      sites: SITES,
    }
    const first = await deliverPermitMails(args)
    expect(first.sent).toBe(6)
    expect(sent).toHaveLength(6)
    expect(sent[0].text).not.toContain('Worker Wren')
    expect(sent[0].text).not.toContain('Do not mail')
    expect(sent[0].html).toContain('https://suite.weehs.org/permits/p1')
    const second = await deliverPermitMails(args)
    expect(second.sent).toBe(0)
    expect(second.skipped).toBe(6)
    expect(sent).toHaveLength(6)
    expect(db.notifications()).toHaveLength(6)
  })

  it('does not claim the ledger when mail is not configured', async () => {
    const sent = []
    const db = memoryDb()
    const result = await deliverPermitMails({
      db,
      orgId: 'orgA',
      docId: 'p1',
      before: null,
      after: permit(),
      mailer: mailer(sent, { pass: '' }),
      logger,
      users: users(),
      sites: SITES,
    })
    expect(result.reason).toBe('not-configured')
    expect(sent).toHaveLength(0)
    expect(db.notifications()).toHaveLength(0)
  })

  it('a failed send stays claimed so the retry does not send a second copy', async () => {
    const sent = []
    const failing = mailer(sent)
    failing.send = async () => {
      sent.push('attempt')
      throw new Error('smtp down')
    }
    const db = memoryDb()
    const args = {
      db,
      orgId: 'orgA',
      docId: 'p1',
      before: null,
      after: permit(),
      mailer: failing,
      logger,
      users: users(),
      sites: SITES,
    }
    const first = await deliverPermitMails(args)
    expect(first.failed).toBe(6)
    expect(sent).toHaveLength(6)
    const second = await deliverPermitMails(args)
    expect(second.skipped).toBe(6)
    expect(sent).toHaveLength(6)
  })

  it('attaches the permit copy and an extra file stored on that permit', async () => {
    const extra = Buffer.from('%PDF-1.4\n% method-statement-marker\n')
    const sent = []
    const calls = []
    const db = memoryDb({
      'organizations/orgA/permits/p1/documents/method': {
        key: 'method',
        label: 'Method statement',
        fileName: 'method-statement.pdf',
        fileType: 'application/pdf',
        fileData: `data:application/pdf;base64,${extra.toString('base64')}`,
      },
      'organizations/orgA/permits/p1/documents/photo': {
        key: 'extra',
        fileName: 'site-photo.jpg',
        fileType: 'image/jpeg',
        filePath: 'orgs/orgA/permit-documents/ab-site-photo.jpg',
      },
    })
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00])
    await deliverPermitMails({
      db,
      orgId: 'orgA',
      docId: 'p1',
      before: null,
      after: permit({
        jobDescription: 'Weld the bracket',
        requiredDocs: [{ key: 'method', label: 'Method statement', mandatory: true }],
        reportPdfPath: APP_PATH,
      }),
      mailer: mailer(sent),
      logger,
      users: users(),
      sites: SITES,
      readObject: async (path) => {
        calls.push(path)
        if (path === APP_PATH) return APP_PDF
        return jpeg
      },
    })
    const names = sent[0].attachments.map((file) => file.filename)
    expect(names).toEqual([
      'Permit-to-Work-PTW-2026-0007.pdf',
      'method-statement.pdf',
      'site-photo.jpg',
    ])
    expect(sent[0].attachments[0].content.equals(APP_PDF)).toBe(true)
    expect(sent[0].attachments[1].content.equals(extra)).toBe(true)
    expect(calls).toEqual([APP_PATH, 'orgs/orgA/permit-documents/ab-site-photo.jpg'])
    expect(sent[0].text).not.toContain('Weld the bracket')
    expect(sent[0].text).not.toContain('Worker Wren')
  })

  it('skips a missing, sealed, or foreign file and still marks the ledger sent', async () => {
    const sent = []
    const calls = []
    const db = memoryDb({
      'organizations/orgA/permits/p1/documents/gone': {
        key: 'extra',
        fileName: 'gone.pdf',
        filePath: 'orgs/orgA/permit-documents/ab-gone.pdf',
      },
      'organizations/orgA/permits/p1/documents/sealed': {
        key: 'extra',
        fileName: 'sealed.pdf',
        filePath: 'orgs/orgA/permit-documents/ab-sealed.pdf',
        encIv: 'iv',
        encKeyId: 'key',
      },
      'organizations/orgA/permits/p1/documents/other': {
        key: 'extra',
        fileName: 'other.pdf',
        filePath: 'orgs/orgB/permit-documents/ab-other.pdf',
        fileUrl: 'https://files.example/orgs/orgB/permit-documents/ab-other.pdf',
      },
    })
    const result = await deliverPermitMails({
      db,
      orgId: 'orgA',
      docId: 'p1',
      before: null,
      after: permit(),
      mailer: mailer(sent),
      logger,
      users: users(),
      sites: SITES,
      readObject: async (path) => {
        calls.push(path)
        throw new Error('No such object')
      },
    })
    expect(result).toMatchObject({ sent: 6, failed: 0 })
    expect(sent[0].attachments || []).toEqual([])
    expect(sent[0].text).toContain('PTW-2026-0007')
    expect(calls).toEqual(['orgs/orgA/permit-documents/ab-gone.pdf'])
    const joined = sent
      .map((message) => `${message.subject}\n${message.text}\n${message.html}`)
      .join('\n')
    expect(joined).not.toContain('https://files.example')
    expect(joined).not.toContain('orgs/orgB')
    for (const path of db.notifications()) expect(db.store.get(path).status).toBe('sent')
  })

  it('does not read storage when mail is not configured, and does not claim', async () => {
    const db = memoryDb({
      'organizations/orgA/permits/p1/documents/gone': {
        filePath: 'orgs/orgA/permit-documents/ab-gone.pdf',
      },
    })
    let reads = 0
    const result = await deliverPermitMails({
      db,
      orgId: 'orgA',
      docId: 'p1',
      before: null,
      after: permit(),
      mailer: mailer([], { pass: '' }),
      logger,
      users: users(),
      sites: SITES,
      readObject: async () => {
        reads += 1
        throw new Error('should not read')
      },
    })
    expect(result.reason).toBe('not-configured')
    expect(reads).toBe(0)
    expect(db.notifications()).toHaveLength(0)
  })

  it('omits a sealed permit number from the body and from the filename', async () => {
    const sent = []
    await deliverPermitMails({
      db: memoryDb(),
      orgId: 'orgA',
      docId: 'p1',
      before: null,
      after: permit({
        permitNo: 'enc:1:general:abcdefghijklmnop:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        reportPdfPath: APP_PATH,
      }),
      mailer: mailer(sent),
      logger,
      users: users(),
      sites: SITES,
      readObject: async () => APP_PDF,
    })
    const blob = sent.map((m) => `${m.subject}\n${m.text}\n${m.html}`).join('\n')
    expect(blob).not.toContain('enc:')
    expect(blob).toContain('Sealed — open the record in the app')
    expect(sent[0].attachments[0].filename).toBe('Permit-to-Work.pdf')
    expect(sent[0].attachments[0].content.equals(APP_PDF)).toBe(true)
    expect(sent[0].attachments[0].content.toString('latin1')).not.toContain('enc:')
  })

  it('waits between recipients when a gap is set', async () => {
    const sent = []
    const waits = []
    const result = await deliverPermitMails({
      db: memoryDb(),
      orgId: 'orgA',
      docId: 'p-gap',
      before: null,
      after: permit(),
      mailer: mailer(sent),
      logger,
      users: users(),
      sites: SITES,
      sleep: async (ms) => {
        waits.push(ms)
      },
      gapMs: 40,
    })
    expect(result.sent).toBe(6)
    expect(sent).toHaveLength(6)
    expect(waits).toEqual([40, 40, 40, 40, 40])
  })

  it('stops on a rate limit, drops that claim, and sends the rest later', async () => {
    const sent = []
    const waits = []
    const db = memoryDb()
    let calls = 0
    const limited = Object.assign(
      new Error('554 5.7.1 Reject: too many messages from sender in last 60 minutes'),
      { responseCode: 554, response: '554 5.7.1 Reject: too many messages' }
    )
    const box = mailer(sent)
    box.send = async (msg) => {
      calls += 1
      if (calls === 2 || calls === 3) throw limited
      sent.push(msg)
    }
    const args = {
      db,
      orgId: 'orgA',
      docId: 'p-rate',
      before: null,
      after: permit(),
      mailer: box,
      logger,
      users: users(),
      sites: SITES,
      sleep: async (ms) => {
        waits.push(ms)
      },
      gapMs: 25,
    }
    const first = await deliverPermitMails(args)
    expect(first).toMatchObject({ sent: 1, failed: 1, skipped: 4, reason: 'rate-limited' })
    expect(sent.map((m) => m.to)).toEqual(['raiser@example.com'])
    expect(waits).toEqual([25, 5000])
    expect(db.notifications()).toHaveLength(1)

    const later = []
    const second = await deliverPermitMails({
      ...args,
      mailer: mailer(later),
      sleep: async () => {},
      gapMs: 0,
    })
    expect(second.sent).toBe(5)
    expect(second.skipped).toBe(1)
    expect(later.map((m) => m.to).sort()).toEqual([
      'admin@example.com',
      'boss@example.com',
      'eng@example.com',
      'member@example.com',
      'ops@example.com',
    ])
    expect(db.notifications()).toHaveLength(6)
  })
})
