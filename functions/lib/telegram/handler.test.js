import { describe, it, expect, vi } from 'vitest'
import {
  verifySecretToken,
  extractUpdate,
  botCommand,
  splitText,
  sendPayloads,
  handleUpdate,
  TG_HELP,
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

describe('handleUpdate', () => {
  it('/help explains the flow and does not name organisations', async () => {
    const { row, reply } = await run('/help', {}, { fresh: true })
    expect(row.outcome).toBe('help')
    expect(reply).toHaveBeenCalledWith(42, { text: TG_HELP })
    expect(TG_HELP).not.toMatch(/Acme|Beta/)
  })
  it('/start asks which organisation', async () => {
    const { row, reply } = await run('/start', {}, { fresh: true, listOrgs: true })
    expect(row.outcome).toBe('orgprompt')
    expect(reply.mock.calls[0][1].text).toMatch(/1\. Acme Fitness/)
    expect(reply.mock.calls[0][1].rows[0].id).toBe('org:org1')
  })
  it('looks up a site by code within the organisation already chosen', async () => {
    const { row, reply, store } = await run('BLR0123')
    expect(row).toMatchObject({ outcome: 'ok', siteId: 's1', orgId: 'org1' })
    expect(store.listSites).toHaveBeenCalledWith('org1')
    expect(reply.mock.calls[0][1].text).toMatch(/Whitefield/)
  })
  it('says the centre was not found when nothing matches', async () => {
    const { row, reply } = await run('zzzz nowhere')
    expect(row.outcome).toBe('nomatch')
    expect(reply.mock.calls[0][1].locationRequest).toBeUndefined()
    expect(reply.mock.calls[0][1].text).toMatch(/Centre not found/)
    expect(reply.mock.calls[0][1].text).toContain('Please enter the Centre ID or Centre Name.')
  })
  it('with one organisation, asks for the centre and accepts an id directly', async () => {
    const { row, reply } = await run('hello', {}, { fresh: true })
    expect(row.outcome).toBe('orgselected')
    expect(reply.mock.calls[0][1].text).toContain('Please enter the Centre ID or Centre Name.')
    expect(reply.mock.calls[0][1].text).toMatch(/Acme Fitness/)
    const looked = await run('BLR0123', {}, { fresh: true })
    expect(looked.row).toMatchObject({ outcome: 'ok', siteId: 's1', orgId: 'org1' })
  })
  it('a shared location lists nearby sites (none located here)', async () => {
    const { row } = await run(undefined, { location: { latitude: 12.9, longitude: 77.6 } })
    expect(row.outcome).toBe('nolocated')
  })
  it('a Telegram retry of the same update is not answered twice', async () => {
    const store = fakeStore()
    const reply = vi.fn(async () => true)
    const u = extractUpdate(update('BLR0123'))
    const ctx = {
      store,
      reply,
      now: NOW,
      orgs: [{ id: 'org1', name: 'Acme Fitness' }],
    }
    await handleUpdate(u, ctx)
    const again = await handleUpdate(u, ctx)
    expect(again.outcome).toBe('duplicate')
    expect(reply).toHaveBeenCalledTimes(2)
  })
  it('rate limited callers get no data', async () => {
    const store = fakeStore()
    store.rate = vi.fn(async () => ({ verdict: 'drop' }))
    const reply = vi.fn(async () => true)
    const row = await handleUpdate(extractUpdate(update('BLR0123')), {
      store,
      reply,
      now: NOW,
      orgs: [{ id: 'org1', name: 'Acme Fitness' }],
    })
    expect(row.outcome).toBe('ratelimited')
    expect(reply).not.toHaveBeenCalled()
  })
  it('walks a fresh chat from organisation to site, and an inline tap counts', async () => {
    const store = fakeStore()
    const reply = vi.fn(async () => true)
    const orgs = [
      { id: 'org1', name: 'Acme Fitness' },
      { id: 'org2', name: 'Beta Safety' },
    ]
    const ctx = { store, reply, now: NOW, orgs, listOrgs: false }
    const first = await handleUpdate(
      extractUpdate(update('hello', { date: NOW.getTime() / 1000 })),
      ctx
    )
    expect(first.outcome).toBe('orgprompt')
    expect(reply.mock.calls[0][1].text).not.toMatch(/Acme|Beta/)

    const named = await handleUpdate(
      extractUpdate(update('beta', { date: NOW.getTime() / 1000 })),
      ctx
    )
    expect(named.outcome).toBe('orgselected')
    expect(reply.mock.calls[1][1].text).toMatch(/Beta Safety/)
    expect(reply.mock.calls[1][1].text).toContain('Please enter the Centre ID or Centre Name.')

    const site = await handleUpdate(
      extractUpdate(update('BETA001', { date: NOW.getTime() / 1000 })),
      ctx
    )
    expect(site).toMatchObject({ outcome: 'ok', siteId: 's9', orgId: 'org2' })
    expect(store.listSites).toHaveBeenCalledWith('org2')

    await handleUpdate(
      extractUpdate(update('/changeorg@WEEHS_Site_Lookup_bot', { date: NOW.getTime() / 1000 })),
      ctx
    )
    const tap = extractUpdate({
      update_id: 4242,
      callback_query: {
        id: 'cb9',
        data: 'org:org1',
        message: { chat: { id: 42, type: 'private' }, date: 1 },
      },
    })
    const answerCallback = vi.fn(async () => {})
    const picked = await handleUpdate(tap, { ...ctx, listOrgs: true, answerCallback })
    expect(picked).toMatchObject({ outcome: 'orgselected', orgId: 'org1' })
    expect(answerCallback).toHaveBeenCalledWith('cb9')
  })
})
