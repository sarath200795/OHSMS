import { describe, it, expect } from 'vitest'
import {
  selectRecipients,
  isFreshReport,
  deliverIncidentReport,
  MAX_REPORT_MAILS,
} from './incidentReportNotify.js'
import { notificationId } from './notify.js'

const APP_PDF = Buffer.from('%PDF-1.4\n% app-incident-report\n')
const APP_PATH = 'orgs/orgA/mailed-reports/ab12cd34-Incident-Report.pdf'

const person = (uid, over = {}) => ({
  uid,
  orgId: 'orgA',
  status: 'approved',
  role: 'member',
  email: `${uid}@example.com`,
  access: {},
  ...over,
})

describe('selectRecipients', () => {
  it('mails every org admin and the reporter, and not a site or region grant', () => {
    const users = [
      person('reporter', { email: 'ada@example.com' }),
      person('boss', { role: 'admin', email: 'Ada@example.com' }),
      person('north', { role: 'admin', email: 'north@example.com' }),
      person('site', { email: 'site@example.com', siteId: 's1' }),
      person('region', { email: 'reg@example.com', access: { regions: ['North'] } }),
    ]
    const { list, overflow } = selectRecipients(users, {
      orgId: 'orgA',
      reporterUid: 'reporter',
    })
    expect(overflow).toBe(0)
    // boss sorts before reporter and shares the mailbox, so ada@ is one send.
    // A site posting and a region grant are not admins.
    expect(list.map((p) => p.uid)).toEqual(['boss', 'north'])
    expect(list.filter((p) => p.email.toLowerCase() === 'ada@example.com')).toHaveLength(1)
  })

  it('skips a missing address, a pending profile, another org, and a uid that is a path', () => {
    const users = [
      person('ok', { role: 'admin' }),
      person('bare', { role: 'admin', email: 'not-an-email' }),
      person('pending', { role: 'admin', status: 'pending', email: 'p@example.com' }),
      person('suspended', { role: 'admin', status: 'suspended', email: 's@example.com' }),
      person('other-org', { role: 'admin', orgId: 'orgB', email: 'b@example.com' }),
      person('a/b', { role: 'admin', email: 'slash@example.com' }),
      person('legacy', { role: 'admin', status: undefined, email: 'legacy@example.com' }),
      person('member', { siteId: 's1', email: 'member@example.com' }),
    ]
    const { list } = selectRecipients(users, { orgId: 'orgA' })
    expect(list.map((p) => p.uid).sort()).toEqual(['legacy', 'ok'])
  })

  it('mails the reporter besides admins, including when the incident names no place', () => {
    const { list } = selectRecipients(
      [
        person('reporter', { siteId: 's9' }),
        person('admin', { role: 'admin' }),
        person('member', { siteId: 's1' }),
        person('manager', { role: 'manager', access: { sites: ['s1'] } }),
        person('blank-region', { access: { regions: [''] } }),
      ],
      { orgId: 'orgA', reporterUid: 'reporter' }
    )
    expect(list.map((p) => p.uid).sort()).toEqual(['admin', 'reporter'])
  })

  it('mails the reporter even when they are not an admin', () => {
    const users = [
      person('reporter', { email: 'ada@example.com', role: 'member', siteId: 's9' }),
      person('north', { email: 'north@example.com', access: { regions: ['North'] } }),
      person('admin', { role: 'admin', email: 'admin@example.com' }),
      person('elsewhere', { email: 'else@example.com', siteId: 's9' }),
    ]
    const { list } = selectRecipients(users, { orgId: 'orgA', reporterUid: 'reporter' })
    expect(list.map((p) => p.uid).sort()).toEqual(['admin', 'reporter'])
  })

  it('does not mail a reporter twice, or one with no usable address', () => {
    const both = selectRecipients(
      [person('reporter', { role: 'admin' }), person('north', { role: 'admin' })],
      { orgId: 'orgA', reporterUid: 'reporter' }
    )
    expect(both.list.map((p) => p.uid).sort()).toEqual(['north', 'reporter'])

    const pending = selectRecipients(
      [person('reporter', { status: 'pending', email: 'ada@example.com' })],
      { orgId: 'orgA', reporterUid: 'reporter' }
    )
    expect(pending.list).toEqual([])

    const shared = selectRecipients(
      [
        person('other', { role: 'admin', email: 'ada@example.com' }),
        person('reporter', { email: 'Ada@example.com' }),
      ],
      { orgId: 'orgA', reporterUid: 'reporter' }
    )
    expect(shared.list.map((p) => p.uid)).toEqual(['other'])
  })

  it('keeps the reporter when the cap would drop their uid', () => {
    const users = Array.from({ length: MAX_REPORT_MAILS + 1 }, (_, i) =>
      person(`u${String(i).padStart(3, '0')}`, { role: 'admin', email: `u${i}@example.com` })
    )
    users.push(person('zzz-reporter', { role: 'member', email: 'reporter@example.com' }))
    const { list, overflow } = selectRecipients(users, {
      orgId: 'orgA',
      reporterUid: 'zzz-reporter',
    })
    expect(overflow).toBe(2)
    expect(list).toHaveLength(MAX_REPORT_MAILS)
    expect(list.some((p) => p.uid === 'zzz-reporter')).toBe(true)
    expect(list.some((p) => p.uid === 'u099')).toBe(false)
    const again = selectRecipients([...users].reverse(), {
      orgId: 'orgA',
      reporterUid: 'zzz-reporter',
    })
    expect(again.list.map((p) => p.uid)).toEqual(list.map((p) => p.uid))
  })

  it('caps the send and keeps the same uids on every pass', () => {
    const users = Array.from({ length: MAX_REPORT_MAILS + 3 }, (_, i) =>
      person(`u${String(i).padStart(3, '0')}`, { role: 'admin', email: `u${i}@example.com` })
    )
    const first = selectRecipients(users, { orgId: 'orgA' })
    const second = selectRecipients([...users].reverse(), { orgId: 'orgA' })
    expect(first.overflow).toBe(3)
    expect(first.list).toHaveLength(MAX_REPORT_MAILS)
    expect(second.list.map((p) => p.uid)).toEqual(first.list.map((p) => p.uid))
  })
})

describe('isFreshReport', () => {
  const reported = { stagesDone: { initial: true }, narrative: 'Fell.' }

  it('fires when the initial report is first marked done, including a create that is already reported', () => {
    expect(isFreshReport(null, reported)).toBe(true)
    expect(isFreshReport({ stagesDone: { initial: false } }, reported)).toBe(true)
    expect(isFreshReport({}, reported)).toBe(true)
  })

  it('does not fire on a later edit, a draft create, a delete, or a soft-deleted report', () => {
    expect(isFreshReport(reported, { ...reported, narrative: 'Reworded.' })).toBe(false)
    expect(isFreshReport(null, { stagesDone: { initial: false } })).toBe(false)
    expect(isFreshReport(reported, null)).toBe(false)
    expect(isFreshReport(null, { ...reported, deletedAt: '2026-03-14' })).toBe(false)
  })
})

function dbWith({ users = {}, sites = {} } = {}) {
  const docs = new Map()
  for (const [uid, data] of Object.entries(users)) docs.set(`users/${uid}`, data)
  for (const [id, data] of Object.entries(sites)) docs.set(`organizations/orgA/sites/${id}`, data)
  const reads = []
  return {
    docs,
    reads,
    doc(path) {
      return {
        path,
        async get() {
          reads.push(path)
          const data = docs.get(path)
          return { exists: data !== undefined, data: () => data }
        },
        async create(data) {
          if (docs.has(path)) {
            const err = new Error('already exists')
            err.code = 6
            throw err
          }
          docs.set(path, { ...data })
        },
        async update(patch) {
          docs.set(path, { ...docs.get(path), ...patch })
        },
        async delete() {
          docs.delete(path)
        },
      }
    },
    collection(name) {
      if (name !== 'users') throw new Error(`unexpected collection ${name}`)
      let orgId = null
      const query = {
        where(field, op, value) {
          if (field === 'orgId' && op === '==') orgId = value
          return query
        },
        async get() {
          reads.push(`users?orgId=${orgId}`)
          const found = [...docs.entries()]
            .filter(
              ([path]) => path.startsWith('users/') && !path.slice('users/'.length).includes('/')
            )
            .filter(([, data]) => data.orgId === orgId)
            .map(([path, data]) => ({ id: path.slice('users/'.length), data: () => data }))
          return { docs: found, size: found.length }
        },
      }
      return query
    },
  }
}

function mailer() {
  const sent = []
  return {
    sent,
    config: {
      host: 'smtp.example',
      user: 'smtp-login@example.com',
      from: 'EHS notifications <info@weehs.org>',
      pass: 'secret',
      appOrigin: 'https://suite.weehs.org',
      configured: true,
    },
    async send(msg) {
      sent.push(msg)
    },
  }
}

const log = () => {
  const entries = []
  return {
    entries,
    info: (msg, extra) => entries.push({ level: 'info', msg, extra }),
    error: (msg, extra) => entries.push({ level: 'error', msg, extra }),
  }
}

const draft = {
  refNo: 'IRA-2026-0007',
  narrative: 'A pallet fell.',
  severity: 'high',
  lifecycle: 'reporting',
  siteId: 's1',
  region: 'North',
  site: 'Plant A',
  stagesDone: { initial: false },
  createdBy: 'reporter',
}

describe('deliverIncidentReport', () => {
  const users = {
    reporter: person('reporter', { email: 'ada@example.com', siteId: 's1' }),
    region: person('region', { email: 'reg@example.com', access: { regions: ['North'] } }),
    outsider: person('outsider', { email: 'out@example.com', access: { sites: ['s9'] } }),
    admin: person('admin', { role: 'admin', email: 'admin@example.com' }),
    pending: person('pending', { status: 'pending', email: 'pend@example.com', siteId: 's1' }),
  }

  it('mails each distinct address once, with description and html, and claims the ledger', async () => {
    const db = dbWith({ users, sites: { s1: { name: 'Plant A', region: 'North' } } })
    const box = mailer()
    const after = { ...draft, stagesDone: { initial: true } }
    const result = await deliverIncidentReport({
      db,
      orgId: 'orgA',
      docId: 'inc1',
      before: draft,
      after,
      mailer: box,
      logger: log(),
    })
    expect(result).toMatchObject({ sent: 2, failed: 0 })
    expect(box.sent.map((m) => m.to).sort()).toEqual(['ada@example.com', 'admin@example.com'])
    const ada = box.sent.find((m) => m.to === 'ada@example.com')
    expect(ada.subject).toBe('Incident reported: IRA-2026-0007')
    expect(ada.text).toContain('Description\nA pallet fell.')
    expect(ada.text).toContain('5 Why\nNot recorded yet')
    expect(ada.html).toContain('A pallet fell.')
    expect(ada.text).toContain('Open it: https://suite.weehs.org/incidents/inc1')
    expect(box.sent.filter((m) => m.to === 'ada@example.com')).toHaveLength(1)
    const ledger = [...db.docs.keys()].filter((k) => k.includes('/notifications/'))
    expect(ledger).toHaveLength(2)
    expect(ledger).toContain(
      `organizations/orgA/notifications/${notificationId(['incident.reported', 'orgA', 'inc1', 'reporter'])}`
    )
  })

  it('attaches the app initial-report PDF under the reference filename', async () => {
    const db = dbWith({ users, sites: { s1: { name: 'Plant A', region: 'North' } } })
    const box = mailer()
    const calls = []
    const after = {
      ...draft,
      stagesDone: { initial: true },
      type: 'near_miss',
      incidentDate: '2026-09-01',
      location: 'Warehouse',
      injuryReports: [{ personName: 'Sam', personId: 'p1' }],
      reportPdfPath: APP_PATH,
    }
    await deliverIncidentReport({
      db,
      orgId: 'orgA',
      docId: 'inc1',
      before: draft,
      after,
      mailer: box,
      logger: log(),
      readObject: async (path) => {
        calls.push(path)
        return APP_PDF
      },
    })
    const file = box.sent[0].attachments[0]
    expect(file.filename).toBe('Incident-Report-IRA-2026-0007.pdf')
    expect(file.content.equals(APP_PDF)).toBe(true)
    expect(calls).toEqual([APP_PATH])
    expect(box.sent[0].text).toContain('A pallet fell.')
    expect(box.sent.every((message) => message.attachments[0].content.equals(APP_PDF))).toBe(true)
  })

  it('does not invent a report file for a sealed narrative, and still sends', async () => {
    const sealed = 'enc:1:general:abcdefghijklmnop:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const db = dbWith({
      users: { reporter: person('reporter', { email: 'ada@example.com', siteId: 's1' }) },
    })
    const box = mailer()
    let reads = 0
    const result = await deliverIncidentReport({
      db,
      orgId: 'orgA',
      docId: 'inc1',
      before: draft,
      after: { ...draft, stagesDone: { initial: true }, narrative: sealed, reportPdfPath: sealed },
      mailer: box,
      logger: log(),
      readObject: async () => {
        reads += 1
        return APP_PDF
      },
    })
    expect(result.sent).toBe(1)
    expect(reads).toBe(0)
    expect(box.sent[0].attachments || []).toEqual([])
    expect(box.sent[0].text).not.toContain('enc:')
    expect(
      db.docs.get(
        `organizations/orgA/notifications/${notificationId(['incident.reported', 'orgA', 'inc1', 'reporter'])}`
      ).status
    ).toBe('sent')
  })

  it('mails the reporter when their grants do not reach the site', async () => {
    const db = dbWith({
      users: {
        reporter: person('reporter', { email: 'ada@example.com', siteId: 's9' }),
        outsider: person('outsider', { email: 'out@example.com', siteId: 's9' }),
        admin: person('admin', { role: 'admin', email: 'admin@example.com' }),
      },
      sites: { s1: { name: 'Plant A', region: 'North', entity: 'Acme' } },
    })
    const box = mailer()
    const result = await deliverIncidentReport({
      db,
      orgId: 'orgA',
      docId: 'inc1',
      before: draft,
      after: { ...draft, stagesDone: { initial: true }, createdBy: 'reporter' },
      mailer: box,
      logger: log(),
    })
    expect(result.sent).toBe(2)
    expect(box.sent.map((m) => m.to).sort()).toEqual(['ada@example.com', 'admin@example.com'])
  })

  it('does not send again when the same report event is redelivered', async () => {
    const db = dbWith({ users })
    const after = { ...draft, stagesDone: { initial: true } }
    await deliverIncidentReport({
      db,
      orgId: 'orgA',
      docId: 'inc1',
      before: draft,
      after,
      mailer: mailer(),
      logger: log(),
    })
    const again = mailer()
    const second = await deliverIncidentReport({
      db,
      orgId: 'orgA',
      docId: 'inc1',
      before: draft,
      after,
      mailer: again,
      logger: log(),
    })
    expect(second.sent).toBe(0)
    expect(again.sent).toEqual([])
    expect(second.skipped).toBe(2)
  })

  it('does not send on a later edit, and does not read the directory to decide that', async () => {
    const db = dbWith({ users })
    const after = { ...draft, stagesDone: { initial: true }, narrative: 'Reworded.' }
    const box = mailer()
    const result = await deliverIncidentReport({
      db,
      orgId: 'orgA',
      docId: 'inc1',
      before: { ...draft, stagesDone: { initial: true } },
      after,
      mailer: box,
      logger: log(),
    })
    expect(result.reason).toBe('not-a-report')
    expect(box.sent).toEqual([])
    expect(db.reads).toEqual([])
  })

  it('logs and skips when SMTP is not configured, without claiming the ledger or reading users', async () => {
    const db = dbWith({ users })
    const logger = log()
    const result = await deliverIncidentReport({
      db,
      orgId: 'orgA',
      docId: 'inc1',
      before: draft,
      after: { ...draft, stagesDone: { initial: true } },
      mailer: {
        config: { host: '', from: '', pass: '' },
        async send() {
          throw new Error('should not send')
        },
      },
      logger,
    })
    expect(result.reason).toBe('not-configured')
    expect(logger.entries[0].extra.missing).toEqual([
      'SMTP_HOST',
      'SMTP_USER',
      'MAIL_FROM',
      'SMTP_PASS',
    ])
    expect([...db.docs.keys()].some((k) => k.includes('/notifications/'))).toBe(false)
    expect(db.reads).toEqual([])
  })

  it('records a failed send and still returns, so the incident write is not retried into a second copy', async () => {
    const db = dbWith({
      users: { reporter: person('reporter', { email: 'ada@example.com', siteId: 's1' }) },
    })
    const logger = log()
    const result = await deliverIncidentReport({
      db,
      orgId: 'orgA',
      docId: 'inc1',
      before: draft,
      after: { ...draft, stagesDone: { initial: true } },
      logger,
      mailer: {
        config: mailer().config,
        async send() {
          throw new Error('smtp down')
        },
      },
    })
    expect(result).toMatchObject({ sent: 0, failed: 1 })
    const row = [...db.docs.values()].find((d) => d && d.kind === 'incident.reported')
    expect(row.status).toBe('failed')
    const again = mailer()
    const second = await deliverIncidentReport({
      db,
      orgId: 'orgA',
      docId: 'inc1',
      before: draft,
      after: { ...draft, stagesDone: { initial: true } },
      mailer: again,
      logger,
    })
    expect(second.sent).toBe(0)
    expect(again.sent).toEqual([])
  })

  it('reads the site so the mail can name the region, and does not mail a region grant', async () => {
    const db = dbWith({
      users: {
        region: person('region', { access: { regions: ['North'] } }),
        admin: person('admin', { role: 'admin', email: 'admin@example.com' }),
      },
      sites: { s1: { region: 'North', entity: 'Acme', name: 'Plant A' } },
    })
    const box = mailer()
    await deliverIncidentReport({
      db,
      orgId: 'orgA',
      docId: 'inc1',
      before: null,
      after: {
        refNo: 'IRA-9',
        narrative: 'Spill.',
        siteId: 's1',
        stagesDone: { initial: true },
      },
      mailer: box,
      logger: log(),
    })
    expect(box.sent.map((m) => m.to)).toEqual(['admin@example.com'])
    expect(box.sent[0].text).toContain('Region: North')
    expect(db.reads).toContain('organizations/orgA/sites/s1')
  })

  it('releases a rate-limited claim and does not claim the rest of the list', async () => {
    const db = dbWith({
      users: {
        reporter: person('reporter', { email: 'ada@example.com' }),
        admin: person('admin', { role: 'admin', email: 'admin@example.com' }),
        boss: person('boss', { role: 'admin', email: 'boss@example.com' }),
      },
    })
    const waits = []
    let calls = 0
    const sent = []
    const limited = Object.assign(
      new Error('554 5.7.1 Reject: too many messages from sender in last 60 minutes'),
      { responseCode: 554, response: '554 5.7.1 Reject: too many messages' }
    )
    const after = { ...draft, stagesDone: { initial: true } }
    const result = await deliverIncidentReport({
      db,
      orgId: 'orgA',
      docId: 'inc1',
      before: draft,
      after,
      logger: log(),
      sleep: async (ms) => {
        waits.push(ms)
      },
      gapMs: 15,
      mailer: {
        sent,
        config: mailer().config,
        async send(msg) {
          calls += 1
          if (calls === 1) {
            sent.push(msg)
            return
          }
          throw limited
        },
      },
    })
    expect(result).toMatchObject({ sent: 1, failed: 1, skipped: 1, reason: 'rate-limited' })
    expect(sent.map((m) => m.to)).toEqual(['admin@example.com'])
    expect(waits).toEqual([15, 5000])
    const ledger = [...db.docs.keys()].filter((k) => k.includes('/notifications/'))
    expect(ledger).toHaveLength(1)

    const again = mailer()
    const second = await deliverIncidentReport({
      db,
      orgId: 'orgA',
      docId: 'inc1',
      before: draft,
      after,
      mailer: again,
      logger: log(),
      sleep: async () => {},
      gapMs: 0,
    })
    expect(second.sent).toBe(2)
    expect(again.sent.map((m) => m.to).sort()).toEqual(['ada@example.com', 'boss@example.com'])
  })

  it('does not read a site id that would change the Firestore path', async () => {
    const db = dbWith({
      users: { admin: person('admin', { role: 'admin' }) },
    })
    const box = mailer()
    await deliverIncidentReport({
      db,
      orgId: 'orgA',
      docId: 'inc1',
      before: null,
      after: {
        narrative: 'Fell.',
        siteId: 's1/../../other',
        stagesDone: { initial: true },
      },
      mailer: box,
      logger: log(),
    })
    expect(db.reads.some((path) => String(path).includes('sites/'))).toBe(false)
    expect(box.sent.map((m) => m.to)).toEqual(['admin@example.com'])
  })
})
