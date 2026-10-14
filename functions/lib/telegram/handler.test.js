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

const NOW = new Date('2026-10-15T06:00:00Z')
const SITES = [
  { id: 's1', name: 'Whitefield Hub', code: 'BLR0123', region: 'South' },
  { id: 's2', name: 'Andheri Hub', code: 'BOM0456', region: 'West' },
]

function fakeStore() {
  const seen = new Set()
  return {
    logs: [],
    claimInbound: vi.fn(async (id) => (seen.has(id) ? false : (seen.add(id), true))),
    rate: vi.fn(async (_k, fn) => fn({})),
    listSites: vi.fn(async () => SITES),
    siteCounts: vi.fn(async () => ({ asOf: NOW, sites: {} })),
    siteContext: vi.fn(async () => ({ contacts: [], roleLabels: {}, modules: {} })),
    getSession: vi.fn(async () => null),
    setSession: vi.fn(async () => {}),
    async log(row) {
      this.logs.push({ ...row })
    },
  }
}

const update = (text, extra = {}) => ({
  update_id: 1000 + Math.floor(Math.random() * 1e6),
  message: { date: NOW.getTime() / 1000, chat: { id: 42, type: 'private' }, text, ...extra },
})

async function run(text, extra) {
  const store = fakeStore()
  const reply = vi.fn(async () => true)
  const row = await handleUpdate(extractUpdate(update(text, extra)), {
    store,
    reply,
    now: NOW,
    orgId: 'org1',
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
})

describe('handleUpdate', () => {
  it('/start replies with help', async () => {
    const { row, reply } = await run('/start')
    expect(row.outcome).toBe('help')
    expect(reply).toHaveBeenCalledWith(42, { text: TG_HELP })
  })
  it('looks up a site by code within the configured org', async () => {
    const { row, reply, store } = await run('BLR0123')
    expect(row).toMatchObject({ outcome: 'ok', siteId: 's1', orgId: 'org1' })
    expect(store.listSites).toHaveBeenCalledWith('org1')
    expect(reply.mock.calls[0][1].text).toMatch(/Whitefield/)
  })
  it('asks for a location when nothing matches', async () => {
    const { row, reply } = await run('zzzz nowhere')
    expect(row.outcome).toBe('nomatch')
    expect(reply.mock.calls[0][1].locationRequest).toBe(true)
  })
  it('a shared location lists nearby sites (none located here)', async () => {
    const { row } = await run(undefined, { location: { latitude: 12.9, longitude: 77.6 } })
    expect(row.outcome).toBe('nolocated')
  })
  it('a Telegram retry of the same update is not answered twice', async () => {
    const store = fakeStore()
    const reply = vi.fn(async () => true)
    const u = extractUpdate(update('BLR0123'))
    await handleUpdate(u, { store, reply, now: NOW, orgId: 'org1' })
    const again = await handleUpdate(u, { store, reply, now: NOW, orgId: 'org1' })
    expect(again.outcome).toBe('duplicate')
    expect(reply).toHaveBeenCalledTimes(1)
  })
  it('rate limited callers get no data', async () => {
    const store = fakeStore()
    store.rate = vi.fn(async () => ({ verdict: 'drop' }))
    const reply = vi.fn(async () => true)
    const row = await handleUpdate(extractUpdate(update('BLR0123')), {
      store,
      reply,
      now: NOW,
      orgId: 'org1',
    })
    expect(row.outcome).toBe('ratelimited')
    expect(reply).not.toHaveBeenCalled()
  })
})
