import { describe, it, expect, vi } from 'vitest'
import { planDrillReport, deliverDrillReport } from './drillReportNotify.js'
import * as reports from './reportAttachments.js'
import { memoryDb, mailer, user } from '../test-support/memoryDb.js'

const SEALED = 'enc:1:general:abcdefghijklmnop:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

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

  it('attaches the drill report and keeps a sealed debrief out of the file', async () => {
    const sent = []
    await deliverDrillReport({
      db: db(),
      orgId: 'orgA',
      docId: 'd1',
      before: null,
      after: {
        ...drill,
        checklist: ['Sound the alarm.'],
        checklistStatus: { 0: true },
        photoCount: 2,
      },
      mailer: mailer(sent),
      logger,
      users,
    })
    const file = sent[0].attachments[0]
    expect(file.filename).toBe('Mock-Drill-Report-DR-1.pdf')
    expect(file.content.subarray(0, 5).toString()).toBe('%PDF-')
    const pdf = file.content.toString('latin1')
    expect(pdf).toContain('Fire Emergency')
    expect(pdf).toContain('PASS')
    expect(pdf).toContain('Sound the alarm.')
    expect(pdf).toContain('Priya')
    expect(pdf).toContain('not included in this copy')
    expect(pdf).not.toContain('enc:')
    expect(sent[0].text).not.toContain('Priya')
    expect(sent.every((message) => message.attachments[0].filename === file.filename)).toBe(true)
  })

  it('still sends the body when the report cannot be built, and marks the ledger sent', async () => {
    const sent = []
    const store = db()
    const spy = vi.spyOn(reports, 'drillReportPdf').mockImplementation(() => {
      throw new Error('pdf failed')
    })
    try {
      const result = await deliverDrillReport({
        db: store,
        orgId: 'orgA',
        docId: 'd1',
        before: null,
        after: drill,
        mailer: mailer(sent),
        logger,
        users,
      })
      expect(result.sent).toBe(2)
      expect(sent[0].text).toContain('Fire Emergency')
      expect(sent[0].attachments || []).toEqual([])
      for (const path of store.notifications()) expect(store.store.get(path).status).toBe('sent')
    } finally {
      spy.mockRestore()
    }
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
