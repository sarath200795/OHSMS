import { describe, it, expect } from 'vitest'
import { planDrillReport, deliverDrillReport } from './drillReportNotify.js'
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
