import { describe, it, expect } from 'vitest'
import {
  planLotoPermitEvents,
  recipientsForLotoEvent,
  deliverLotoPermitMails,
} from './lotoPermitNotify.js'
import { renderLotoPermitMail } from './mailTemplates/lifecycle.js'
import { memoryDb, mailer, user } from '../test-support/memoryDb.js'

const HOUR = 3600 * 1000
const END = Date.parse('2026-10-05T14:00:00Z')

function permit(extra = {}) {
  return {
    permitNo: 'LP-2026-0007',
    status: 'requested',
    workType: 'machine_maintenance',
    // Sealed at rest in production: must never reach a mailbox.
    reason: 'enc:1:abc:def',
    requestedByName: 'enc:1:abc:name',
    equipment: 'Pump A',
    site: 'Plant 2',
    siteId: 's1',
    region: 'South',
    entity: 'COCO',
    requestedBy: 'raiser',
    personnelUids: ['crew1', 'crew2'],
    windowStart: END - 8 * HOUR,
    windowEnd: END,
    ...extra,
  }
}
const SITES = [{ id: 's1', name: 'Plant 2', region: 'South', entity: 'COCO' }]
const users = () => [
  user('raiser', { name: 'Rita Raiser' }),
  user('crew1', { name: 'Crew One' }),
  user('crew2', { name: 'Crew Two' }),
  user('adm', { role: 'admin', name: 'Ada Admin' }),
  user('adm2', { role: 'admin', name: 'Ben Admin' }),
  user('grant', { role: 'manager', access: { sites: ['s1'] } }),
  user('far', { role: 'manager', access: { sites: ['s9'] } }),
  user('bystander', { role: 'member', siteId: 's2' }),
  user('gone', { role: 'member', status: 'suspended' }),
]
const names = (events) => events.map((e) => e.name)

describe('planLotoPermitEvents', () => {
  it('requested on create; nothing for a document that arrives already decided', () => {
    expect(names(planLotoPermitEvents(null, permit()))).toEqual(['requested'])
    expect(planLotoPermitEvents(null, permit({ status: 'active' }))).toEqual([])
    expect(planLotoPermitEvents(null, null)).toEqual([])
  })

  it('approved and rejected on the decision, keyed by the decision time', () => {
    const at = { toMillis: () => 1234 }
    const a = planLotoPermitEvents(
      permit(),
      permit({ status: 'approved', approval: { by: 'adm', at } })
    )
    expect(names(a)).toEqual(['approved'])
    expect(a[0]).toMatchObject({ actorUid: 'adm', token: 'approved:1234' })
    expect(
      names(
        planLotoPermitEvents(permit(), permit({ status: 'rejected', approval: { by: 'adm', at } }))
      )
    ).toEqual(['rejected'])
  })

  it('returned and emergency_removed when an active permit closes', () => {
    const active = permit({ status: 'active' })
    expect(
      names(planLotoPermitEvents(active, permit({ status: 'returned', closure: { by: 'crew1' } })))
    ).toEqual(['returned'])
    const em = planLotoPermitEvents(
      active,
      permit({ status: 'emergency_removed', emergency: { by: 'adm' } })
    )
    expect(names(em)).toEqual(['emergency_removed'])
    expect(em[0].actorUid).toBe('adm')
  })

  it('says nothing for withdrawn, for the start of isolation, or for a touch of updatedAt', () => {
    expect(planLotoPermitEvents(permit(), permit({ status: 'withdrawn' }))).toEqual([])
    expect(
      planLotoPermitEvents(permit({ status: 'approved' }), permit({ status: 'active' }))
    ).toEqual([])
    expect(
      planLotoPermitEvents(permit({ status: 'active' }), permit({ status: 'active', updatedAt: 2 }))
    ).toEqual([])
  })

  it('extended when an extension is appended to an active permit', () => {
    const before = permit({ status: 'active', extensions: [{ by: 'adm' }] })
    const after = permit({
      status: 'active',
      extensions: [{ by: 'adm' }, { by: 'adm2' }],
      windowEnd: END + HOUR,
    })
    const e = planLotoPermitEvents(before, after)
    expect(names(e)).toEqual(['extended'])
    expect(e[0]).toMatchObject({ actorUid: 'adm2', token: 'extended:2' })
  })

  describe('due and overdue from the server flags', () => {
    const active = (flags) => permit({ status: 'active', flags })

    it('due once, for the current window', () => {
      const e = planLotoPermitEvents(active(undefined), active({ windowEnd: END, dueAt: 5 }))
      expect(names(e)).toEqual(['due'])
      expect(e[0].token).toBe(`due:${END}`)
      // The same flags written again are not news.
      expect(
        planLotoPermitEvents(
          active({ windowEnd: END, dueAt: 5 }),
          active({ windowEnd: END, dueAt: 5 })
        )
      ).toEqual([])
    })

    it('overdue on every increment of the count; escalated from the third', () => {
      const f = (n) => active({ windowEnd: END, dueAt: 1, overdueCount: n })
      expect(names(planLotoPermitEvents(f(0), f(1)))).toEqual(['overdue'])
      expect(names(planLotoPermitEvents(f(1), f(2)))).toEqual(['overdue'])
      expect(names(planLotoPermitEvents(f(2), f(3)))).toEqual(['overdue_escalated'])
      expect(planLotoPermitEvents(f(3), f(3))).toEqual([])
      expect(planLotoPermitEvents(f(1), f(2))[0].token).toBe(`overdue:${END}:2`)
    })

    it('ignores flags that describe a window since extended', () => {
      const e = planLotoPermitEvents(
        active(undefined),
        active({ windowEnd: END - HOUR, overdueCount: 2, dueAt: 1 })
      )
      expect(e).toEqual([])
    })

    it('starts the count again in a new window', () => {
      const before = active({ windowEnd: END - HOUR, overdueCount: 4, dueAt: 1 })
      const after = active({ windowEnd: END, overdueCount: 1, dueAt: 9 })
      expect(names(planLotoPermitEvents(before, after)).sort()).toEqual(['due', 'overdue'])
    })

    it('no overdue mail for a permit that is not active', () => {
      const after = permit({ status: 'returned', flags: { windowEnd: END, overdueCount: 2 } })
      expect(planLotoPermitEvents(permit({ status: 'active' }), after).map((e) => e.name)).toEqual([
        'returned',
      ])
    })
  })
})

describe('recipientsForLotoEvent', () => {
  it('names the requester, approver, remover, crew and the scoped admins — and nobody else', () => {
    const p = permit({
      status: 'emergency_removed',
      approval: { by: 'adm2' },
      emergency: { by: 'adm' },
    })
    const { recipients } = recipientsForLotoEvent({}, p, users(), SITES, 'orgA')
    const ids = recipients.map((r) => r.uid)
    expect(ids[0]).toBe('raiser')
    expect(new Set(ids)).toEqual(new Set(['raiser', 'adm', 'adm2', 'crew1', 'crew2', 'grant']))
    expect(ids).not.toContain('far')
    expect(ids).not.toContain('bystander')
    expect(ids).not.toContain('gone')
  })

  it('does not look for contractors: they are text on the permit and have no mailbox', () => {
    const p = permit({
      vendorWorkers: [{ name: 'enc:1:x', company: 'enc:1:y', contact: 'v@example.com' }],
    })
    const { recipients } = recipientsForLotoEvent({}, p, users(), SITES, 'orgA')
    expect(
      recipients.every((r) => r.email.endsWith('@example.com') && !r.email.startsWith('v@'))
    ).toBe(true)
  })

  it('reaches only admins when the permit carries no scope at all', () => {
    const p = permit({ siteId: '', site: '', region: '', entity: '' })
    const { recipients } = recipientsForLotoEvent({}, p, users(), [], 'orgA')
    expect(new Set(recipients.map((r) => r.uid))).toEqual(
      new Set(['raiser', 'crew1', 'crew2', 'adm', 'adm2'])
    )
  })

  it('never crosses organisations', () => {
    const others = [...users(), { ...user('stranger', { role: 'admin' }), orgId: 'orgB' }]
    const { recipients } = recipientsForLotoEvent({}, permit(), others, SITES, 'orgA')
    expect(recipients.map((r) => r.uid)).not.toContain('stranger')
  })

  it('keeps the requester first even when the cap would cut the list', () => {
    const many = [
      user('zzz-requester'),
      ...Array.from({ length: 5 }, (_, i) => user(`a${i}`, { role: 'admin' })),
    ]
    const { recipients } = recipientsForLotoEvent(
      {},
      permit({ requestedBy: 'zzz-requester', personnelUids: [] }),
      many,
      SITES,
      'orgA'
    )
    expect(recipients[0].uid).toBe('zzz-requester')
  })
})

describe('renderLotoPermitMail', () => {
  const ev = {
    subjectLead: 'LOTO permit requested',
    headline: 'H',
    status: 'Awaiting approval',
    region: 'South',
    entity: 'COCO',
    path: '/loto/permits/LP-2026-0007',
    actorName: 'Rita Raiser',
  }

  it('carries the permit, equipment, window and standard — and never a sealed value', () => {
    const m = renderLotoPermitMail(permit(), ev, {
      appOrigin: 'https://suite.weehs.org',
      sender: 'Acme Plant',
    })
    expect(m.subject).toBe('LOTO permit requested: LP-2026-0007')
    for (const body of [m.text, m.html]) {
      expect(body).toContain('Pump A')
      expect(body).toContain('Machine maintenance')
      expect(body).toContain('OSHA 29 CFR 1910.147')
      expect(body).toContain('IST')
      expect(body).not.toContain('enc:1:')
    }
    expect(m.html).toContain('https://suite.weehs.org/loto/permits/LP-2026-0007')
  })

  it('prints the window in the plant’s zone, with the zone named', () => {
    const m = renderLotoPermitMail(permit(), ev, {})
    // 14:00 UTC is 19:30 IST.
    expect(m.text).toContain('05 Oct 2026')
    expect(m.text).toContain('19:30 IST')
  })

  it('does not brand the mail as WEEHS in the visible text', () => {
    const m = renderLotoPermitMail(permit(), ev, {
      appOrigin: 'https://suite.weehs.org',
      sender: '',
    })
    expect(m.text.replace(/info@weehs\.org|suite\.weehs\.org/g, '')).not.toMatch(/weehs/i)
  })
})

describe('deliverLotoPermitMails', () => {
  const logger = { info() {}, error() {} }
  const base = () => ({
    db: memoryDb(),
    orgId: 'orgA',
    docId: 'LP-2026-0007',
    logger,
    users: users(),
    sites: SITES,
  })

  it('mails every named person once for a request, and a retry sends nothing more', async () => {
    const sent = []
    const args = { ...base(), before: null, after: permit(), mailer: mailer(sent) }
    const first = await deliverLotoPermitMails(args)
    expect(first.sent).toBe(6) // raiser, 2 crew, 2 admins, 1 site-grant holder
    expect(sent).toHaveLength(6)
    expect(sent.every((m) => !m.text.includes('enc:1:'))).toBe(true)
    const second = await deliverLotoPermitMails(args)
    expect(second.sent).toBe(0)
    expect(second.skipped).toBe(6)
    expect(sent).toHaveLength(6)
  })

  it('repeats an overdue notice per count — each is its own ledger row — but never twice for one count', async () => {
    const sent = []
    const m = mailer(sent)
    const db = memoryDb()
    const f = (n) =>
      permit({ status: 'active', flags: { windowEnd: END, dueAt: 1, overdueCount: n } })
    const mk = (before, after) => ({ ...base(), db, before, after, mailer: m })
    await deliverLotoPermitMails(mk(f(0), f(1)))
    const afterOne = sent.length
    await deliverLotoPermitMails(mk(f(0), f(1)))
    expect(sent).toHaveLength(afterOne)
    await deliverLotoPermitMails(mk(f(1), f(2)))
    expect(sent.length).toBe(afterOne * 2)
    await deliverLotoPermitMails(mk(f(2), f(3)))
    expect(sent[sent.length - 1].subject).toMatch(/ESCALATED/)
  })

  it('mails nobody and claims nothing when mail is not configured', async () => {
    const sent = []
    const args = { ...base(), before: null, after: permit(), mailer: mailer(sent, { pass: '' }) }
    const r = await deliverLotoPermitMails(args)
    expect(r.reason).toBe('not-configured')
    expect(sent).toHaveLength(0)
    expect(args.db.notifications()).toHaveLength(0)
  })

  it('does nothing for a write that is not news', async () => {
    const sent = []
    const r = await deliverLotoPermitMails({
      ...base(),
      before: permit(),
      after: permit({ updatedAt: 3 }),
      mailer: mailer(sent),
    })
    expect(r).toEqual({ sent: 0, skipped: 0, failed: 0 })
    expect(sent).toHaveLength(0)
  })
})
