import { describe, it, expect, beforeEach } from 'vitest'
import { handleMessage, SESSION_TTL_MS } from './handler.js'
import { MESSAGES } from './format.js'

// A fake store with the same contract as store.js, backed by plain maps.
function fakeStore(seed = {}) {
  const s = {
    inbound: new Set(),
    links: new Map(Object.entries(seed.links || {})),
    users: new Map(Object.entries(seed.users || {})),
    codes: new Map(Object.entries(seed.codes || {})),
    rate: new Map(),
    sessions: new Map(),
    sites: seed.sites || {},
    logs: [],
  }
  return {
    s,
    async claimInbound(wamid) {
      if (s.inbound.has(wamid)) return false
      s.inbound.add(wamid)
      return true
    },
    async getLink(waId) {
      return s.links.get(waId) || null
    },
    async getUser(uid) {
      return s.users.get(uid) || null
    },
    async redeemLinkCode(code, waId) {
      const rec = s.codes.get(code)
      s.codes.delete(code)
      if (!rec) return { ok: false, reason: 'missing' }
      s.links.set(waId, { uid: rec.uid, orgId: rec.orgId })
      return { ok: true, ...rec }
    },
    async unlink(waId) {
      s.links.delete(waId)
    },
    async rate(waId, fn) {
      const out = fn(s.rate.get(waId) || {})
      s.rate.set(waId, out.state)
      return out
    },
    async listSites(orgId) {
      return s.sites[orgId] || []
    },
    async siteCounts() {
      return {
        asOf: new Date('2026-10-12T02:00:00Z'),
        sites: { s1: { extinguishers: 6, hptOverdue: 1, openDefects: 0, firstAidBoxes: 2 } },
      }
    },
    async siteContext() {
      return { contacts: [], modules: {} }
    },
    async getSession(waId) {
      return s.sessions.get(waId) || null
    },
    async setSession(waId, v) {
      s.sessions.set(waId, v)
    },
    async clearSession(waId) {
      s.sessions.delete(waId)
    },
    async log(row, waId) {
      s.logs.push({ ...row, waId })
    },
  }
}

const SITES = [
  { id: 's1', name: 'Demo North Hub', code: 'DEMO001', region: 'North', entity: 'Demo' },
  { id: 's2', name: 'Demo South Hub', code: 'DEMO002', region: 'South', entity: 'Demo' },
  { id: 's3', name: 'Demo South Annex', code: 'DEMO003', region: 'South', entity: 'Demo' },
]
const PHONE = '919000000001'
const NOW = new Date('2026-10-12T05:00:00Z')
let n = 0
const msg = (text, extra = {}) => ({
  wamid: `wamid.${(n += 1)}`,
  from: PHONE,
  timestamp: NOW.getTime() / 1000,
  text,
  ...extra,
})

let store
let sent
const ctx = () => ({
  store,
  now: NOW,
  reply: async (to, m) => {
    sent.push({ to, ...m })
    return true
  },
})

const member = (extra = {}) => ({
  orgId: 'o1',
  status: 'approved',
  role: 'member',
  siteId: 's1',
  ...extra,
})

beforeEach(() => {
  sent = []
  store = fakeStore({
    links: { [PHONE]: { uid: 'u1', orgId: 'o1' } },
    users: { u1: member() },
    sites: { o1: SITES },
  })
})

describe('authorised lookups', () => {
  it('answers a code inside reach with the summary', async () => {
    const row = await handleMessage(msg('DEMO001'), ctx())
    expect(row).toMatchObject({ outcome: 'ok', siteId: 's1', uid: 'u1', orgId: 'o1' })
    expect(sent[0].text).toContain('Demo North Hub (DEMO001)')
    expect(sent[0].text).toContain('Fire extinguishers: 6 (1 HPT overdue)')
  })

  // Not "no access": the site exists, but outside reach it is not searched at
  // all, so the reply cannot confirm that it does.
  it('answers a site outside reach exactly like a site that does not exist', async () => {
    await handleMessage(msg('DEMO002'), ctx())
    await handleMessage(msg('NOPE999'), ctx())
    expect(sent[0].text).toMatch(/^No site you can access matches "demo002"/)
    expect(sent[1].text).toMatch(/^No site you can access matches "nope999"/)
    expect(store.s.logs.map((l) => l.outcome)).toEqual(['nomatch', 'nomatch'])
  })

  it('refuses a list tap for a site outside reach', async () => {
    const row = await handleMessage(msg('x', { choiceId: 'site:s2' }), ctx())
    expect(row.outcome).toBe('denied')
    expect(sent[0].text).toBe(MESSAGES.noAccess)
  })

  it('offers a pick-list when a name is ambiguous', async () => {
    store.s.users.set('u1', member({ access: { regions: ['South'] } }))
    await handleMessage(msg('demo south'), ctx())
    expect(sent[0].rows.map((r) => r.id)).toEqual(['site:s3', 'site:s2'])
  })

  it('answers "hi" with the only site when there is exactly one', async () => {
    await handleMessage(msg('Hi'), ctx())
    expect(sent[0].text).toContain('Demo North Hub')
  })

  it('re-checks the profile live: a suspended user gets no data', async () => {
    store.s.users.set('u1', member({ status: 'suspended' }))
    const row = await handleMessage(msg('DEMO001'), ctx())
    expect(row.outcome).toBe('denied')
    expect(sent[0].text).toBe(MESSAGES.unlinked)
  })

  it('refuses a profile moved to another org, or awaiting a password change', async () => {
    store.s.users.set('u1', member({ orgId: 'o2' }))
    expect((await handleMessage(msg('DEMO001'), ctx())).outcome).toBe('denied')
    store.s.users.set('u1', member({ mustChangePassword: true }))
    expect((await handleMessage(msg('DEMO001'), ctx())).outcome).toBe('denied')
    expect(sent.every((m) => !m.text.includes('Fire extinguishers'))).toBe(true)
  })
})

describe('unknown senders', () => {
  it('get one polite reply a day and no data', async () => {
    store.s.links.clear()
    await handleMessage(msg('DEMO001'), ctx())
    await handleMessage(msg('DEMO001'), ctx())
    expect(sent).toHaveLength(1)
    expect(sent[0].text).toBe(MESSAGES.unlinked)
    expect(store.s.logs.map((l) => l.outcome)).toEqual(['unknown', 'unknown'])
  })
})

describe('linking', () => {
  beforeEach(() => store.s.links.clear())

  it('binds the number with a valid code', async () => {
    store.s.codes.set('482913', { uid: 'u1', orgId: 'o1' })
    const row = await handleMessage(msg('LINK 482913'), ctx())
    expect(row.outcome).toBe('linked')
    expect(store.s.links.get(PHONE)).toEqual({ uid: 'u1', orgId: 'o1' })
    expect(sent[0].text).toBe(MESSAGES.linked)
  })

  it('blocks the number after five wrong codes', async () => {
    for (let i = 0; i < 5; i += 1) await handleMessage(msg('LINK 000000'), ctx())
    expect(sent.at(-1).text).toBe(MESSAGES.linkBlocked)
    store.s.codes.set('482913', { uid: 'u1', orgId: 'o1' })
    const row = await handleMessage(msg('LINK 482913'), ctx())
    expect(row.outcome).toBe('blocked')
    expect(store.s.links.size).toBe(0)
  })
})

describe('unlink, dedupe, staleness and limits', () => {
  it('UNLINK removes the binding', async () => {
    await handleMessage(msg('UNLINK'), ctx())
    expect(store.s.links.size).toBe(0)
    expect(sent[0].text).toBe(MESSAGES.unlinkedOk)
  })

  it('a Meta retry of the same wamid is not answered twice', async () => {
    const m = msg('DEMO001')
    await handleMessage(m, ctx())
    const again = await handleMessage(m, ctx())
    expect(again.outcome).toBe('duplicate')
    expect(sent).toHaveLength(1)
  })

  it('does not answer a message older than an hour', async () => {
    const row = await handleMessage(
      msg('DEMO001', { timestamp: NOW.getTime() / 1000 - 7200 }),
      ctx()
    )
    expect(row.outcome).toBe('stale')
    expect(sent).toHaveLength(0)
  })

  it('stops after 30 lookups an hour with a single notice', async () => {
    for (let i = 0; i < 33; i += 1) await handleMessage(msg('DEMO001'), ctx())
    expect(sent.filter((m) => m.text === MESSAGES.slowDown)).toHaveLength(1)
    expect(sent).toHaveLength(31)
  })

  it('never logs the message text', async () => {
    await handleMessage(msg('DEMO001 secret words'), ctx())
    expect(JSON.stringify(store.s.logs)).not.toContain('secret words')
  })
})

describe('location fallback and numbered picks', () => {
  const GEO = [
    { ...SITES[0], lat: 12.0, lng: 77.0 },
    { ...SITES[1], lat: 12.2, lng: 77.0 },
    { ...SITES[2], lat: 12.01, lng: 77.0 },
    { id: 's4', name: 'Demo South Depot', code: 'DEMO004', region: 'South', entity: 'Demo' },
  ]
  const loc = (latitude, longitude) =>
    msg('', { type: 'location', location: { latitude, longitude } })
  beforeEach(() => {
    store.s.sites.o1 = GEO
    store.s.users.set('u1', member({ siteId: 's9', access: { regions: ['South'] } }))
  })

  it('asks for a location when nothing matches', async () => {
    const row = await handleMessage(msg('zzz'), ctx())
    expect(row.outcome).toBe('nomatch')
    expect(sent[0]).toMatchObject({ locationRequest: true })
    expect(sent[0].text).toContain('Tap 📎 → Location')
  })

  it('lists only reachable sites with coordinates, nearest first, and logs no coordinates', async () => {
    const row = await handleMessage(loc(12.0, 77.0), ctx())
    expect(row.outcome).toBe('nearby')
    // s1 is nearest of all but outside reach; s4 has no coordinates.
    expect(sent[0].rows.map((r) => r.id)).toEqual(['site:s3', 'site:s2'])
    expect(sent[0].text).toMatch(/1\. Demo South Annex \(DEMO003\) — 1\.1 km/)
    expect(JSON.stringify(store.s.logs)).not.toMatch(/77|latitude/)
    expect(store.s.sessions.get(PHONE).choices).toEqual(['s3', 's2'])
  })

  it("answers a number from the list with that site's summary", async () => {
    await handleMessage(loc(12.0, 77.0), ctx())
    const row = await handleMessage(msg('2'), ctx())
    expect(row).toMatchObject({ outcome: 'ok', siteId: 's2' })
    expect(sent[1].text).toContain('Demo South Hub (DEMO002)')
  })

  it('a list-row tap returns the summary', async () => {
    await handleMessage(loc(12.0, 77.0), ctx())
    const row = await handleMessage(msg('x', { choiceId: 'site:s3' }), ctx())
    expect(row).toMatchObject({ outcome: 'ok', siteId: 's3' })
  })

  it('an expired list no longer answers numbers', async () => {
    await handleMessage(loc(12.0, 77.0), ctx())
    store.s.sessions.get(PHONE).expiresAtMs = NOW.getTime() - 1
    const row = await handleMessage(msg('1'), ctx())
    expect(row.outcome).toBe('nomatch')
    expect(SESSION_TTL_MS).toBe(15 * 60 * 1000)
  })

  it("refuses a pick whose site has left the user's reach since the list", async () => {
    await handleMessage(loc(12.0, 77.0), ctx())
    store.s.users.set('u1', member())
    const row = await handleMessage(msg('1'), ctx())
    expect(row.outcome).toBe('denied')
  })

  it('makes ambiguous-name lists answerable by number', async () => {
    await handleMessage(msg('demo south'), ctx())
    const first = store.s.sessions.get(PHONE).choices[0]
    const row = await handleMessage(msg('1'), ctx())
    expect(row.siteId).toBe(first)
  })

  it('says so when no reachable site has coordinates', async () => {
    store.s.sites.o1 = SITES
    await handleMessage(loc(12.0, 77.0), ctx())
    expect(sent[0].text).toBe(MESSAGES.noLocatedSites)
  })
})
