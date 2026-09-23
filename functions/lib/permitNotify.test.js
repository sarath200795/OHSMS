import { describe, it, expect } from 'vitest'
import {
  planPermitEvents,
  recipientsForPermitEvent,
  deliverPermitMails,
  matchPermitSite,
} from './permitNotify.js'
import { memoryDb, mailer, user } from '../test-support/memoryDb.js'

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
  it('mails the named approvers and not the raiser, the worker or the receiver', () => {
    const event = planPermitEvents(null, permit())[0]
    const { recipients } = recipientsForPermitEvent(event, permit(), users(), SITES, 'orgA')
    expect(recipients.map((r) => r.uid).sort()).toEqual(['eng', 'ops'])
  })

  it('when no approver is named, mails admins and managers who reach the site', () => {
    const open = permit({ assignedEngineer: null, assignedOperator: null })
    const event = planPermitEvents(null, open)[0]
    expect(event.needsTeam).toBe(true)
    const { recipients } = recipientsForPermitEvent(event, open, users(), SITES, 'orgA')
    expect(recipients.map((r) => r.uid).sort()).toEqual(['admin', 'boss'])
  })

  it('does not let an empty-string region grant match a site with no region', () => {
    const open = permit({
      assignedEngineer: null,
      assignedOperator: null,
      site: 'Mystery',
      siteId: '',
    })
    const event = planPermitEvents(null, open)[0]
    const sites = [{ id: 's2', name: 'Other', region: '', entity: '' }]
    expect(matchPermitSite(open, sites)).toBeNull()
    const { recipients } = recipientsForPermitEvent(event, open, users(), sites, 'orgA')
    expect(recipients.map((r) => r.uid)).toEqual(['admin'])
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
    expect(first.sent).toBe(2)
    expect(sent).toHaveLength(2)
    expect(sent[0].text).not.toContain('Worker Wren')
    expect(sent[0].text).not.toContain('Do not mail')
    expect(sent[0].html).toContain('https://suite.weehs.org/permits/p1')
    const second = await deliverPermitMails(args)
    expect(second.sent).toBe(0)
    expect(second.skipped).toBe(2)
    expect(sent).toHaveLength(2)
    expect(db.notifications()).toHaveLength(2)
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
    expect(first.failed).toBe(2)
    expect(sent).toHaveLength(2)
    const second = await deliverPermitMails(args)
    expect(second.skipped).toBe(2)
    expect(sent).toHaveLength(2)
  })

  it('omits a sealed permit number from the body', async () => {
    const sent = []
    await deliverPermitMails({
      db: memoryDb(),
      orgId: 'orgA',
      docId: 'p1',
      before: null,
      after: permit({
        permitNo: 'enc:1:general:abcdefghijklmnop:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      }),
      mailer: mailer(sent),
      logger,
      users: users(),
      sites: SITES,
    })
    const blob = sent.map((m) => `${m.subject}\n${m.text}\n${m.html}`).join('\n')
    expect(blob).not.toContain('enc:')
    expect(blob).toContain('Sealed — open the record in the app')
  })
})
