import { describe, it, expect } from 'vitest'
import { planDrillReport, deliverDrillReport } from './drillReportNotify.js'
import { memoryDb, mailer, user } from '../test-support/memoryDb.js'

const SEALED = 'enc:1:general:abcdefghijklmnop:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const APP_PDF = Buffer.from('%PDF-1.4\n% app-mock-drill-report\n')
const APP_PATH = 'orgs/orgA/mailed-reports/ab12cd34-Mock-Drill-Report.pdf'

function appReader(bytes = APP_PDF, calls = []) {
  return async (path) => {
    calls.push(path)
    if (path !== APP_PATH) throw new Error(`unexpected ${path}`)
    return bytes
  }
}

const drill = {
  scenario: 'Fire Emergency',
  eventType: 'Mock Drill',
  date: '2026-09-01',
  time: '09:30',
  outcome: 'Pass',
  score: 80,
  docId: 'DR-1',
  siteId: 's1',
  region: '',
  entity: '',
  centerName: 'Plant 2',
  debrief: SEALED,
  commander: 'Priya',
  commanders: ['Priya'],
}

describe('planDrillReport', () => {
  it('plans a create and ignores an edit', () => {
    const planned = planDrillReport(null, drill)
    expect(planned.scoreLabel).toBe('80%')
    expect(planned.scenario).toBe('Fire Emergency')
    expect(planned.debrief).toBeUndefined()
    expect(planned.commander).toBeUndefined()
    expect(planDrillReport(drill, { ...drill, outcome: 'Fail' })).toBeNull()
    expect(planDrillReport(null, { ...drill, deletedAt: 'x' })).toBeNull()
  })
})

describe('deliverDrillReport', () => {
  const logger = { info() {}, error() {} }
  const users = [
    user('admin', { role: 'admin' }),
    user('region', { access: { regions: ['South'] } }),
    user('manager', { role: 'manager' }),
    user('far', { siteId: 's9' }),
  ]

  function db() {
    return memoryDb({
      'organizations/orgA/sites/s1': { name: 'Plant 2', region: 'South', entity: 'COCO' },
    })
  }

  it('mails admins and region grants, fills the region from the site, and does not repeat', async () => {
    const sent = []
    const store = db()
    const args = {
      db: store,
      orgId: 'orgA',
      docId: 'd1',
      before: null,
      after: drill,
      mailer: mailer(sent),
      logger,
      users,
    }
    expect((await deliverDrillReport(args)).sent).toBe(2)
    expect(sent.map((m) => m.to).sort()).toEqual(['admin@example.com', 'region@example.com'])
    const blob = sent.map((m) => `${m.subject}\n${m.text}\n${m.html}`).join('\n')
    expect(blob).toContain('Fire Emergency')
    expect(blob).toContain('Outcome: Pass')
    expect(blob).toContain('Score: 80%')
    expect(blob).toContain('Region: South')
    expect(blob).toContain('https://suite.weehs.org/mock-drills')
    expect(blob).not.toContain('Priya')
    expect(blob).not.toContain('enc:')
    expect((await deliverDrillReport(args)).skipped).toBe(2)
    expect(sent).toHaveLength(2)
  })

  it('attaches the app PDF bytes and keeps the commander out of the body', async () => {
    const sent = []
    const calls = []
    await deliverDrillReport({
      db: db(),
      orgId: 'orgA',
      docId: 'd1',
      before: null,
      after: { ...drill, debrief: SEALED, reportPdfPath: APP_PATH },
      mailer: mailer(sent),
      logger,
      users,
      readObject: appReader(APP_PDF, calls),
    })
    const file = sent[0].attachments[0]
    expect(file.filename).toBe('Mock-Drill-Report-DR-1.pdf')
    expect(file.content.equals(APP_PDF)).toBe(true)
    expect(calls).toEqual([APP_PATH])
    expect(sent[0].text).not.toContain('Priya')
    expect(sent[0].text).not.toContain('enc:')
    expect(sent.every((message) => message.attachments[0].content.equals(APP_PDF))).toBe(true)
  })

  it('does not read a foreign, sealed, or missing report path', async () => {
    const sent = []
    const calls = []
    const store = db()
    const result = await deliverDrillReport({
      db: store,
      orgId: 'orgA',
      docId: 'd1',
      before: null,
      after: {
        ...drill,
        reportPdfPath: 'orgs/orgB/mailed-reports/ab-other.pdf',
      },
      mailer: mailer(sent),
      logger,
      users,
      readObject: async (path) => {
        calls.push(path)
        return APP_PDF
      },
    })
    expect(result.sent).toBe(2)
    expect(calls).toEqual([])
    expect(sent[0].attachments || []).toEqual([])
    expect(sent[0].text).toContain('Fire Emergency')
    for (const path of store.notifications()) expect(store.store.get(path).status).toBe('sent')
  })

  it('skips a sealed object and still marks the ledger sent', async () => {
    const sent = []
    const store = db()
    const result = await deliverDrillReport({
      db: store,
      orgId: 'orgA',
      docId: 'd1',
      before: null,
      after: { ...drill, reportPdfPath: APP_PATH },
      mailer: mailer(sent),
      logger,
      users,
      readObject: async () => Buffer.from(`${SEALED}\n`),
    })
    expect(result.sent).toBe(2)
    expect(sent[0].attachments || []).toEqual([])
    expect(sent[0].text).not.toContain('enc:')
    for (const path of store.notifications()) expect(store.store.get(path).status).toBe('sent')
  })

  it('still sends the body when the app PDF is missing, and marks the ledger sent', async () => {
    const sent = []
    const store = db()
    let reads = 0
    const result = await deliverDrillReport({
      db: store,
      orgId: 'orgA',
      docId: 'd1',
      before: null,
      after: drill,
      mailer: mailer(sent),
      logger,
      users,
      readObject: async () => {
        reads += 1
        throw new Error('should not read')
      },
    })
    expect(result.sent).toBe(2)
    expect(reads).toBe(0)
    expect(sent[0].text).toContain('Fire Emergency')
    expect(sent[0].attachments || []).toEqual([])
    for (const path of store.notifications()) expect(store.store.get(path).status).toBe('sent')
  })

  it('does not claim when mail is not configured', async () => {
    const store = db()
    const result = await deliverDrillReport({
      db: store,
      orgId: 'orgA',
      docId: 'd1',
      before: null,
      after: drill,
      mailer: mailer([], { pass: '' }),
      logger,
      users,
    })
    expect(result.reason).toBe('not-configured')
    expect(store.notifications()).toHaveLength(0)
  })
})
