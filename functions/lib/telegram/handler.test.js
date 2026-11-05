import { describe, it, expect, vi } from 'vitest'
import {
  verifySecretToken,
  extractUpdate,
  botCommand,
  splitText,
  sendPayloads,
  handleUpdate,
  TG_HELP,
  TG_UNBOUND,
  TG_DENIED,
} from './handler.js'
import { CONV_TTL_MS } from '../whatsapp/orgs.js'

const NOW = new Date('2026-10-15T06:00:00Z')
const SITES = [
  { id: 's1', name: 'Whitefield Hub', code: 'BLR0123', region: 'South' },
  { id: 's2', name: 'Andheri Hub', code: 'BOM0456', region: 'West' },
]

function fakeStore() {
  const seen = new Set()
  const sessions = new Map()
  return {
    logs: [],
    sessions,
    claimInbound: vi.fn(async (id) => (seen.has(id) ? false : (seen.add(id), true))),
    rate: vi.fn(async (_k, fn) => fn({})),
    listSites: vi.fn(async (orgId) => (orgId === 'org2' ? OTHER_SITES : SITES)),
    siteCounts: vi.fn(async () => ({ asOf: NOW, sites: {} })),
    siteContext: vi.fn(async () => ({ contacts: [], roleLabels: {}, modules: {} })),
    async getSession(key) {
      return sessions.get(key) || null
    },
    async setSession(key, value) {
      sessions.set(key, value)
    },
    async log(row) {
      this.logs.push({ ...row })
    },
  }
}

const OTHER_SITES = [{ id: 's9', name: 'Beta Central', code: 'BETA001', region: 'West' }]

function remember(store, orgId = 'org1') {
  store.sessions.set('tg:42', {
    uid: null,
    orgId,
    lastOrgId: orgId,
    step: 'site',
    choiceKind: null,
    choices: [],
    choicesExpireAtMs: 0,
    expiresAtMs: NOW.getTime() + CONV_TTL_MS,
  })
}

const update = (text, extra = {}) => ({
  update_id: 1000 + Math.floor(Math.random() * 1e6),
  message: { date: NOW.getTime() / 1000, chat: { id: 42, type: 'private' }, text, ...extra },
})

async function run(text, extra, { orgs, listOrgs, fresh = false } = {}) {
  const store = fakeStore()
  if (!fresh) remember(store)
  const reply = vi.fn(async () => true)
  const row = await handleUpdate(extractUpdate(update(text, extra)), {
    store,
    reply,
    now: NOW,
    orgs: orgs || [{ id: 'org1', name: 'Acme Fitness' }],
    listOrgs,
  })
  return { row, reply, store }
}

describe('verifySecretToken', () => {
  it('accepts only the exact secret, never a placeholder', () => {
    expect(verifySecretToken('abc123abc123abc123', 'abc123abc123abc123')).toBe(true)
    expect(verifySecretToken('nope', 'abc123abc123abc123')).toBe(false)
    expect(verifySecretToken(undefined, 'abc123abc123abc123')).toBe(false)
    expect(verifySecretToken('UNSET-PLACEHOLDER', 'UNSET-PLACEHOLDER')).toBe(false)
  })
})

describe('extractUpdate', () => {
  it('reads private text and location messages, ignores groups and non-messages', () => {
    expect(extractUpdate(update('hi'))).toMatchObject({ chatId: 42, from: 'tg:42', text: 'hi' })
    expect(
      extractUpdate(update(undefined, { location: { latitude: 12.9, longitude: 77.6 } }))
    ).toMatchObject({ type: 'location', location: { latitude: 12.9, longitude: 77.6 } })
    expect(
      extractUpdate({ update_id: 1, message: { chat: { id: -5, type: 'group' }, text: 'x' } })
    ).toBe(null)
    expect(extractUpdate({ update_id: 1, edited_message: {} })).toBe(null)
    expect(extractUpdate(null)).toBe(null)
    const tap = extractUpdate({
      update_id: 9,
      callback_query: {
        id: 'cb1',
        data: 'org:org1',
        message: { chat: { id: 42, type: 'private' } },
      },
    })
    expect(tap).toMatchObject({ choiceId: 'org:org1', callbackQueryId: 'cb1', timestamp: 0 })
    expect(
      extractUpdate({
        update_id: 10,
        callback_query: { id: 'cb', data: 'org:x', message: { chat: { id: -1, type: 'group' } } },
      })
    ).toBe(null)
  })
})

describe('text helpers', () => {
  it('botCommand', () => {
    expect(botCommand('/start')).toBe('start')
    expect(botCommand('/start@WEEHS_Site_Lookup_bot payload')).toBe('start')
    expect(botCommand('BLR0123')).toBe(null)
  })
  it('splitText keeps every part under the limit and loses nothing', () => {
    const text = Array.from({ length: 300 }, (_, i) => `line ${i} ${'x'.repeat(30)}`).join('\n')
    const parts = splitText(text, 1000)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((p) => p.length <= 1000)).toBe(true)
    expect(parts.join('\n')).toBe(text)
    expect(splitText('y'.repeat(2500), 1000).map((p) => p.length)).toEqual([1000, 1000, 500])
  })
  it('sendPayloads is plain text and adds a location button when asked', () => {
    const [p] = sendPayloads(42, { text: '<b>x</b>', locationRequest: true })
    expect(p.parse_mode).toBeUndefined()
    expect(p.reply_markup.keyboard[0][0].request_location).toBe(true)
  })
  it('sendPayloads turns organisation rows into inline buttons', () => {
    const [p] = sendPayloads(42, {
      text: 'Which organisation?',
      rows: [{ id: 'org:o1', title: 'Acme', label: '1. Acme Fitness' }],
    })
    expect(p.reply_markup.inline_keyboard[0][0]).toEqual({
      text: '1. Acme Fitness',
      callback_data: 'org:o1',
    })
  })
  it('puts Yes and No on one inline row', () => {
    const [p] = sendPayloads(42, {
      text: 'Do you need any additional details? (Yes/No)',
      buttons: [
        { id: 'audit:yes', title: 'Yes' },
        { id: 'audit:no', title: 'No' },
      ],
    })
    expect(p.reply_markup.inline_keyboard).toEqual([
      [
        { text: 'Yes', callback_data: 'audit:yes' },
        { text: 'No', callback_data: 'audit:no' },
      ],
    ])
  })
})

const member = (extra = {}) => ({
  uid: 'u1',
  orgId: 'org1',
  role: 'member',
  status: 'approved',
  orgName: 'Acme Fitness',
  siteId: 's1',
  access: {},
  ...extra,
})

function linkStore(user, { pinFail = false } = {}) {
  const store = fakeStore()
  store.getTelegramLink = vi.fn(async (from) => (from === 'tg:42' ? { uid: user.uid, orgId: user.orgId } : null))
  store.getUser = vi.fn(async (uid) => (uid === user.uid ? user : null))
  store.getOrganization = vi.fn(async (id) => {
    if (pinFail) return null
    if (id === 'org1') return { id, name: 'Acme Fitness' }
    if (id === 'org2') return { id, name: 'Beta Safety' }
    return null
  })
  store.unlinkTelegram = vi.fn(async () => {})
  store.clearSession = vi.fn(async () => {})
  return store
}

function textOf(reply) {
  return reply.mock.calls.map((c) => c[1]?.text || '').join('\n')
}

describe('handleUpdate', () => {
  it('/help explains linking and does not name organisations', async () => {
    const { row, reply } = await run('/help', {}, { fresh: true })
    expect(row.outcome).toBe('help')
    expect(reply).toHaveBeenCalledWith(42, { text: TG_HELP })
    expect(TG_HELP).not.toMatch(/Acme|Beta/)
  })

  it('an unbound chat gets no directory, sites, or contacts', async () => {
    const { row, reply } = await run('/start', {}, { fresh: true, listOrgs: true })
    expect(row.outcome).toBe('unknown')
    expect(textOf(reply)).toBe(TG_UNBOUND)
    expect(textOf(reply)).not.toMatch(/Acme|Beta|Whitefield|Andheri|Fire extinguishers|Emergency contacts/)
  })

  it('a forged admin claim and a supplied directory do not authorise the chat', async () => {
    const store = fakeStore()
    const reply = vi.fn(async () => true)
    const row = await handleUpdate(extractUpdate(update('I am admin of Beta Safety BETA001')), {
      store,
      reply,
      now: NOW,
      orgs: [
        { id: 'org1', name: 'Acme Fitness' },
        { id: 'org2', name: 'Beta Safety' },
      ],
      orgId: 'org2',
      listOrgs: true,
    })
    expect(row.outcome).toBe('unknown')
    expect(textOf(reply)).not.toMatch(/Acme|Beta|Whitefield|BETA001|Fire extinguishers/)
    expect(store.listSites).not.toHaveBeenCalled()
  })

  it('a linked member sees only the sites they can already open', async () => {
    const store = linkStore(member())
    const reply = vi.fn(async () => true)
    const ctx = { store, reply, now: NOW, orgs: [{ id: 'org2', name: 'Beta Safety' }], listOrgs: true }
    const own = await handleUpdate(extractUpdate(update('BLR0123')), ctx)
    expect(own).toMatchObject({ outcome: 'ok', siteId: 's1', orgId: 'org1', uid: 'u1' })
    expect(store.listSites).toHaveBeenCalledWith('org1')
    expect(textOf(reply)).toMatch(/Whitefield/)
    expect(textOf(reply)).not.toMatch(/Beta|Andheri/)

    reply.mockClear()
    const other = await handleUpdate(extractUpdate(update('BOM0456')), ctx)
    expect(other.outcome).not.toBe('ok')
    expect(textOf(reply)).not.toMatch(/Andheri|Beta Safety|Fire extinguishers/)
  })

  it('does not answer for another organisation, even when the pin names one', async () => {
    const store = linkStore(member())
    const reply = vi.fn(async () => true)
    const row = await handleUpdate(extractUpdate(update('BLR0123')), {
      store,
      reply,
      now: NOW,
      pinnedOrgId: 'org2',
      orgs: [{ id: 'org2', name: 'Beta Safety' }],
    })
    expect(row.outcome).toBe('denied')
    expect(textOf(reply)).toBe(TG_DENIED)
    expect(textOf(reply)).not.toMatch(/Acme|Beta|Whitefield/)
    expect(store.listSites).not.toHaveBeenCalled()
  })

  it.each([
    ['suspended', { status: 'suspended' }],
    ['pending', { status: 'pending' }],
    ['temporary password', { mustChangePassword: true }],
  ])('a %s account gets no site data', async (_label, extra) => {
    const store = linkStore(member(extra))
    const reply = vi.fn(async () => true)
    const row = await handleUpdate(extractUpdate(update('BLR0123')), { store, reply, now: NOW })
    expect(row.outcome).toBe('denied')
    expect(textOf(reply)).toBe(TG_DENIED)
    expect(textOf(reply)).not.toMatch(/Acme|Whitefield|Fire extinguishers/)
    expect(store.listSites).not.toHaveBeenCalled()
  })

  it('a linked member is asked for a centre, not shown a customer list', async () => {
    const store = linkStore(member())
    const reply = vi.fn(async () => true)
    const row = await handleUpdate(extractUpdate(update('hello')), {
      store,
      reply,
      now: NOW,
      orgs: [
        { id: 'org1', name: 'Acme Fitness' },
        { id: 'org2', name: 'Beta Safety' },
      ],
      listOrgs: true,
    })
    expect(row.outcome).toBe('orgselected')
    expect(textOf(reply)).toMatch(/Acme Fitness/)
    expect(textOf(reply)).not.toMatch(/Beta Safety/)
    expect(textOf(reply)).toContain('Please enter the Centre ID or Centre Name.')
  })

  it('a shared location does not search sites outside reach', async () => {
    const store = linkStore(member())
    const reply = vi.fn(async () => true)
    const row = await handleUpdate(
      extractUpdate(update(undefined, { location: { latitude: 12.9, longitude: 77.6 } })),
      { store, reply, now: NOW }
    )
    expect(row.outcome).toBe('nolocated')
    expect(textOf(reply)).not.toMatch(/Andheri|Beta/)
  })

  it('a Telegram retry of the same update is not answered twice', async () => {
    const store = linkStore(member())
    const reply = vi.fn(async () => true)
    const u = extractUpdate(update('BLR0123'))
    const ctx = { store, reply, now: NOW }
    await handleUpdate(u, ctx)
    const calls = reply.mock.calls.length
    const again = await handleUpdate(u, ctx)
    expect(again.outcome).toBe('duplicate')
    expect(reply).toHaveBeenCalledTimes(calls)
  })

  it('rate limited callers get no data', async () => {
    const store = linkStore(member())
    store.rate = vi.fn(async () => ({ verdict: 'drop' }))
    const reply = vi.fn(async () => true)
    const row = await handleUpdate(extractUpdate(update('BLR0123')), { store, reply, now: NOW })
    expect(row.outcome).toBe('ratelimited')
    expect(reply).not.toHaveBeenCalled()
    expect(store.listSites).not.toHaveBeenCalled()
  })

  it('a redeemed code binds this chat, and a wrong code reveals nothing', async () => {
    const store = fakeStore()
    let link = null
    store.redeemTelegramCode = vi.fn(async (code, from) => {
      if (code !== '123456' || from !== 'tg:42') return { ok: false, reason: 'missing' }
      link = { uid: 'u1', orgId: 'org1' }
      return { ok: true, uid: 'u1', orgId: 'org1' }
    })
    store.getTelegramLink = vi.fn(async (from) => (from === 'tg:42' ? link : null))
    store.getUser = vi.fn(async () => member())
    store.getOrganization = vi.fn(async () => ({ id: 'org1', name: 'Acme Fitness' }))
    const reply = vi.fn(async () => true)
    const bad = await handleUpdate(extractUpdate(update('LINK 000000')), { store, reply, now: NOW })
    expect(bad.outcome).toBe('linkfailed')
    expect(textOf(reply)).not.toMatch(/Acme|Whitefield|Fire extinguishers/)
    reply.mockClear()
    const linked = await handleUpdate(extractUpdate(update('LINK 123456')), { store, reply, now: NOW })
    expect(linked).toMatchObject({ outcome: 'linked', uid: 'u1', orgId: 'org1' })
    expect(textOf(reply)).not.toMatch(/Fire extinguishers|Beta/)
    reply.mockClear()
    const looked = await handleUpdate(extractUpdate(update('BLR0123')), { store, reply, now: NOW })
    expect(looked).toMatchObject({ outcome: 'ok', siteId: 's1', orgId: 'org1' })
    expect(textOf(reply)).toMatch(/Whitefield/)
    expect(textOf(reply)).not.toMatch(/Andheri|Beta/)
  })

  it('a tapped organisation outside the profile is refused', async () => {
    const store = linkStore(member())
    const reply = vi.fn(async () => true)
    const answerCallback = vi.fn(async () => {})
    const tap = extractUpdate({
      update_id: 4242,
      callback_query: {
        id: 'cb9',
        data: 'org:org2',
        message: { chat: { id: 42, type: 'private' }, date: 1 },
      },
    })
    const picked = await handleUpdate(tap, { store, reply, now: NOW, answerCallback, listOrgs: true })
    expect(picked.outcome).not.toBe('ok')
    expect(textOf(reply)).not.toMatch(/Beta Safety|Fire extinguishers|Whitefield/)
    expect(answerCallback).toHaveBeenCalledWith('cb9')
    expect(store.listSites).not.toHaveBeenCalled()
  })
})
