import { describe, it, expect } from 'vitest'
import { memoryDb } from '../../test-support/memoryDb.js'
import {
  deliverLinkWelcome,
  linkIdentity,
  linkStamp,
  linkWelcomeKey,
  organisationLabel,
  planLinkWelcome,
  welcomeText,
} from './linkWelcome.js'

const PHONE = '919000000001'
const WELCOME =
  'Welcome! You are now linked to Acme Fitness Safety through WhatsApp. ' +
  'Send the Center ID, Center Name, or Location to get the details.'

const link = (extra = {}) => ({ uid: 'u1', orgId: 'orgA', linkedAtMs: 1_700_000_000_000, ...extra })

function harness(extra = {}) {
  const sent = []
  const logs = []
  const logger = {
    info(message, fields) {
      logs.push({ level: 'info', message, fields })
    },
    error(message, fields) {
      logs.push({ level: 'error', message, fields })
    },
  }
  const db = extra.db || memoryDb({ 'organizations/orgA': { name: 'Acme Fitness' } })
  const send =
    extra.send ||
    (async (to, text) => {
      sent.push({ to, text })
      return { ok: true, status: 200 }
    })
  const run = (over = {}) =>
    deliverLinkWelcome({
      db,
      waId: PHONE,
      before: null,
      after: link(),
      send,
      logger,
      now: new Date('2026-10-24T08:00:00Z'),
      pepper: 'test-pepper',
      configured: true,
      ...over,
    })
  return { sent, logs, logger, db, send, run }
}

describe('welcomeText', () => {
  it('names the organisation in the one sentence', () => {
    expect(welcomeText('Acme Fitness')).toBe(WELCOME)
  })

  it('drops formatting markers and newlines so the name cannot restyle the sentence', () => {
    expect(welcomeText('*_Acme_*\nFitness')).toBe(WELCOME)
  })

  it('falls back when the name is missing or sealed', () => {
    const fallback =
      'Welcome! You are now linked to your organisation Safety through WhatsApp. ' +
      'Send the Center ID, Center Name, or Location to get the details.'
    expect(welcomeText('')).toBe(fallback)
    expect(welcomeText('enc:1:not-a-name')).toBe(fallback)
    expect(organisationLabel('enc:1:not-a-name', 'Beta Safety')).toBe('Beta Safety')
    expect(organisationLabel('', '')).toBe('your organisation')
  })
})

describe('planLinkWelcome', () => {
  it('sends on a new binding and not on a re-save of the same one', () => {
    expect(planLinkWelcome(null, link()).send).toBe(true)
    expect(planLinkWelcome(undefined, link()).send).toBe(true)
    const again = planLinkWelcome(link({ linkedAtMs: 1 }), link({ linkedAtMs: 2, source: 'admin' }))
    expect(again).toEqual({ send: false, reason: 'resave' })
  })

  it('sends when the number moves to another person or organisation', () => {
    expect(planLinkWelcome(link(), link({ uid: 'u2', linkedAtMs: 2 })).send).toBe(true)
    expect(planLinkWelcome(link(), link({ orgId: 'orgB', linkedAtMs: 2 })).send).toBe(true)
  })

  it('does not send for a delete, a failed redeem, or a path-shaped id', () => {
    expect(planLinkWelcome(link(), null)).toEqual({ send: false, reason: 'not-a-link' })
    expect(planLinkWelcome(null, { orgId: 'orgA' }).reason).toBe('not-a-link')
    expect(planLinkWelcome(null, { uid: 'a/b', orgId: 'orgA' }).reason).toBe('not-a-link')
    expect(linkIdentity({ uid: 'u1', orgId: 'orgA' })).toEqual({ uid: 'u1', orgId: 'orgA' })
  })
})

describe('linkStamp', () => {
  it('prefers linkedAtMs, then a Timestamp, then seconds', () => {
    expect(linkStamp(link({ linkedAtMs: 50 }))).toBe('50')
    expect(linkStamp({ linkedAt: { toMillis: () => 80 } })).toBe('80')
    expect(linkStamp({ linkedAt: { _seconds: 3, _nanoseconds: 5_000_000 } })).toBe('3005')
    expect(linkStamp({})).toBe('')
  })

  it('does not put the phone number in the ledger key', () => {
    const key = linkWelcomeKey('pepper', PHONE, 'u1', 'orgA', '50')
    expect(key[0]).toBe('whatsapp.link')
    expect(key.join(' ')).not.toContain(PHONE)
    expect(linkWelcomeKey('pepper', PHONE, 'u1', 'orgA', '50')).toEqual(key)
    expect(linkWelcomeKey('pepper', PHONE, 'u1', 'orgA', '51')).not.toEqual(key)
  })
})

describe('deliverLinkWelcome', () => {
  it('sends the welcome once for a new link', async () => {
    const h = harness()
    const first = await h.run()
    const second = await h.run()
    expect(first.status).toBe('sent')
    expect(second).toMatchObject({ status: 'skipped', reason: 'already-claimed' })
    expect(h.sent).toEqual([{ to: PHONE, text: WELCOME }])
    expect(JSON.stringify(h.db.store.get(h.db.notifications()[0]))).not.toContain(PHONE)
    expect(JSON.stringify(h.logs)).not.toContain(PHONE)
  })

  it('does not send on a re-save, a delete, or a link that did not succeed', async () => {
    const h = harness()
    expect(
      (await h.run({ before: link(), after: link({ linkedAtMs: 9, source: 'admin' }) })).reason
    ).toBe('resave')
    expect((await h.run({ before: link(), after: null })).reason).toBe('not-a-link')
    expect((await h.run({ after: { reason: 'expired' } })).reason).toBe('not-a-link')
    expect(h.sent).toEqual([])
    expect(h.db.notifications()).toEqual([])
  })

  it('sends again after the number is unlinked and linked with a new timestamp', async () => {
    const h = harness()
    await h.run({ after: link({ linkedAtMs: 1 }) })
    await h.run({ before: link({ linkedAtMs: 1 }), after: null })
    await h.run({ before: null, after: link({ linkedAtMs: 2 }) })
    expect(h.sent).toHaveLength(2)
    expect(h.sent[1].text).toBe(WELCOME)
  })

  it('uses the profile name when the organisation document has none', async () => {
    const h = harness({
      db: memoryDb({ 'users/u1': { orgName: 'Beta Safety' } }),
    })
    await h.run()
    expect(h.sent[0].text).toContain('Beta Safety Safety')
    expect(h.sent[0].text).not.toContain('your organisation')
  })

  it('says your organisation when neither name exists', async () => {
    const h = harness({ db: memoryDb({}) })
    await h.run()
    expect(h.sent[0].text).toContain('your organisation Safety')
  })

  it('still sends the fallback when the organisation read throws', async () => {
    const db = memoryDb({ 'users/u1': { orgName: 'Profile Org' } })
    const orig = db.doc.bind(db)
    db.doc = (path) => {
      const ref = orig(path)
      if (path === 'organizations/orgA') {
        return {
          ...ref,
          async get() {
            throw new Error('organisation unavailable')
          },
        }
      }
      return ref
    }
    const h = harness({ db })
    const out = await h.run()
    expect(out.status).toBe('sent')
    expect(h.sent[0].text).toContain('Profile Org')
    expect(h.logs.some((l) => l.message.includes('organisation name unreadable'))).toBe(true)
    expect(JSON.stringify(h.logs)).not.toContain(PHONE)
  })

  it('does not send or claim when WhatsApp is not configured', async () => {
    const h = harness()
    const out = await h.run({ configured: false })
    expect(out).toMatchObject({ status: 'skipped', reason: 'not-configured' })
    expect(h.sent).toEqual([])
    expect(h.db.notifications()).toEqual([])
  })

  it('does not send to a document id that is not a phone number', async () => {
    const h = harness()
    const out = await h.run({ waId: 'not-a-number' })
    expect(out.reason).toBe('bad-number')
    expect(h.sent).toEqual([])
    expect(JSON.stringify(h.logs)).not.toContain('not-a-number')
  })

  it('logs a Graph refusal and does not throw or send a second time', async () => {
    let calls = 0
    const h = harness({
      send: async () => {
        calls += 1
        return { ok: false, status: 500, error: 'graph:131000' }
      },
    })
    const first = await h.run()
    const second = await h.run()
    expect(first).toMatchObject({ status: 'failed', reason: 'send-failed' })
    expect(second.reason).toBe('already-claimed')
    expect(calls).toBe(1)
    const failure = h.logs.find((l) => l.level === 'error')
    expect(failure.fields).toMatchObject({
      orgId: 'orgA',
      uid: 'u1',
      error: 'graph:131000',
      status: 500,
    })
    expect(JSON.stringify(h.logs)).not.toContain(PHONE)
  })

  it('logs a thrown send and leaves the link decision resolved', async () => {
    const h = harness({
      send: async () => {
        throw new Error(`post failed for ${PHONE}`)
      },
    })
    await expect(h.run()).resolves.toMatchObject({ status: 'failed' })
    expect(JSON.stringify(h.logs)).not.toContain(PHONE)
  })

  it('does not call Graph when the daily cap is already spent', async () => {
    let calls = 0
    const h = harness({
      send: async () => {
        calls += 1
        return { ok: true, status: 200 }
      },
    })
    const out = await h.run({ reserveOutbound: async () => false })
    expect(out.status).toBe('failed')
    expect(calls).toBe(0)
    expect(h.logs.some((l) => l.fields?.error === 'outbound-cap')).toBe(true)
  })
})
