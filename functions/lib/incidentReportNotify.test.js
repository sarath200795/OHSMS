import { describe, it, expect } from 'vitest'
import {
  incidentScope,
  userReachesScope,
  selectRecipients,
  isFreshReport,
  deliverIncidentReport,
  MAX_REPORT_MAILS,
} from './incidentReportNotify.js'
import { notificationId } from './notify.js'

const person = (uid, over = {}) => ({
  uid,
  orgId: 'orgA',
  status: 'approved',
  role: 'member',
  email: `${uid}@example.com`,
  access: {},
  ...over,
})

describe('incidentScope', () => {
  it('uses the incident fields and fills blanks from the site', () => {
    expect(
      incidentScope({ siteId: 's1', region: 'North' }, { region: 'South', entity: 'Acme' })
    ).toEqual({
      siteId: 's1',
      regions: ['North', 'South'],
      entities: ['Acme'],
    })
  })

  it('drops empty strings so a blank region is not a scope', () => {
    expect(incidentScope({ siteId: '', region: '  ', entity: '' }, { region: '' })).toEqual({
      siteId: '',
      regions: [],
      entities: [],
    })
  })
})

describe('userReachesScope', () => {
  const scope = { siteId: 's1', regions: ['North'], entities: ['Acme'] }

  it('matches a site grant, a posting, a region grant or an entity grant', () => {
    expect(userReachesScope(person('a', { access: { sites: ['s1'] } }), scope)).toBe(true)
    expect(userReachesScope(person('b', { siteId: 's1' }), scope)).toBe(true)
    expect(userReachesScope(person('c', { access: { regions: ['North'] } }), scope)).toBe(true)
    expect(userReachesScope(person('d', { access: { entities: ['Acme'] } }), scope)).toBe(true)
  })

  it('matches a region grant through the site when the incident did not copy the region', () => {
    const filed = incidentScope({ siteId: 's1' }, { region: 'North', entity: 'Acme' })
    expect(userReachesScope(person('c', { access: { regions: ['North'] } }), filed)).toBe(true)
    expect(userReachesScope(person('d', { access: { entities: ['Acme'] } }), filed)).toBe(true)
  })

  it('does not treat an empty-string grant as access to every unscoped field', () => {
    const blank = { siteId: '', regions: [], entities: [] }
    const named = { siteId: 's1', regions: ['North'], entities: ['Acme'] }
    const sloppy = person('e', { access: { sites: [''], regions: [''], entities: [''] } })
    expect(userReachesScope(sloppy, blank)).toBe(false)
    expect(userReachesScope(sloppy, named)).toBe(false)
  })

  it('includes an admin for a scoped report and for one that names no place', () => {
    const admin = person('admin', { role: 'admin', access: {} })
    expect(userReachesScope(admin, scope)).toBe(true)
    expect(userReachesScope(admin, { siteId: '', regions: [], entities: [] })).toBe(true)
  })

  it('does not elevate a manager or an auditor who was not granted the site', () => {
    expect(userReachesScope(person('m', { role: 'manager' }), scope)).toBe(false)
    expect(userReachesScope(person('au', { role: 'auditor' }), scope)).toBe(false)
  })

  it('refuses a grant for a different site, region or entity', () => {
    expect(userReachesScope(person('a', { access: { sites: ['s9'] } }), scope)).toBe(false)
    expect(userReachesScope(person('c', { access: { regions: ['South'] } }), scope)).toBe(false)
    expect(userReachesScope(person('d', { access: { entities: ['Other'] } }), scope)).toBe(false)
    expect(userReachesScope(person('b', { siteId: 's9' }), scope)).toBe(false)
  })
})

describe('selectRecipients', () => {
  const scope = { siteId: 's1', regions: ['North'], entities: [] }

  it('dedupes a shared mailbox and keeps the reporter once', () => {
    const users = [
      person('reporter', { email: 'ada@example.com', siteId: 's1' }),
      person('other', { email: 'Ada@example.com', access: { sites: ['s1'] } }),
      person('north', { email: 'north@example.com', access: { regions: ['North'] } }),
      person('elsewhere', { email: 'else@example.com', access: { sites: ['s9'] } }),
    ]
    const { list, overflow } = selectRecipients(users, { orgId: 'orgA', scope })
    expect(overflow).toBe(0)
    // The earlier uid keeps a shared mailbox. ada@ is one send, not one per grant.
    expect(list.map((p) => p.uid)).toEqual(['north', 'other'])
    expect(list.filter((p) => p.email.toLowerCase() === 'ada@example.com')).toHaveLength(1)
  })

  it('skips a missing address, a pending profile, another org, and a uid that is a path', () => {
    const users = [
      person('ok', { siteId: 's1' }),
      person('bare', { siteId: 's1', email: 'not-an-email' }),
      person('pending', { siteId: 's1', status: 'pending', email: 'p@example.com' }),
      person('suspended', { siteId: 's1', status: 'suspended', email: 's@example.com' }),
      person('other-org', { siteId: 's1', orgId: 'orgB', email: 'b@example.com' }),
      person('a/b', { siteId: 's1', email: 'slash@example.com' }),
      person('legacy', { siteId: 's1', status: undefined, email: 'legacy@example.com' }),
    ]
    const { list } = selectRecipients(users, { orgId: 'orgA', scope })
    expect(list.map((p) => p.uid).sort()).toEqual(['legacy', 'ok'])
  })

  it('caps the send and keeps the same uids on every pass', () => {
    const users = Array.from({ length: MAX_REPORT_MAILS + 3 }, (_, i) =>
      person(`u${String(i).padStart(3, '0')}`, { siteId: 's1', email: `u${i}@example.com` })
    )
    const first = selectRecipients(users, { orgId: 'orgA', scope })
    const second = selectRecipients([...users].reverse(), { orgId: 'orgA', scope })
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
      from: 'WEEHS <info@weehs.org>',
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
    expect(result).toMatchObject({ sent: 3, failed: 0 })
    expect(box.sent.map((m) => m.to).sort()).toEqual([
      'ada@example.com',
      'admin@example.com',
      'reg@example.com',
    ])
    const ada = box.sent.find((m) => m.to === 'ada@example.com')
    expect(ada.subject).toBe('Incident reported: IRA-2026-0007')
    expect(ada.text).toContain('Description\nA pallet fell.')
    expect(ada.text).toContain('5 Why\nNot recorded yet')
    expect(ada.html).toContain('A pallet fell.')
    expect(ada.text).toContain('Open it: https://suite.weehs.org/incidents/inc1')
    expect(box.sent.filter((m) => m.to === 'ada@example.com')).toHaveLength(1)
    const ledger = [...db.docs.keys()].filter((k) => k.includes('/notifications/'))
    expect(ledger).toHaveLength(3)
    expect(ledger).toContain(
      `organizations/orgA/notifications/${notificationId(['incident.reported', 'orgA', 'inc1', 'reporter'])}`
    )
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
    expect(second.skipped).toBe(3)
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
    expect(logger.entries[0].extra.missing).toEqual(['SMTP_HOST', 'MAIL_FROM', 'SMTP_PASS'])
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

  it('uses the site record so a region grant matches an incident that only stored the site id', async () => {
    const db = dbWith({
      users: { region: person('region', { access: { regions: ['North'] } }) },
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
    expect(box.sent.map((m) => m.to)).toEqual(['region@example.com'])
    expect(box.sent[0].text).toContain('Region: North')
    expect(db.reads).toContain('organizations/orgA/sites/s1')
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
