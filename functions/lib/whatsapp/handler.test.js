import { describe, it, expect, beforeEach } from 'vitest'
import { handleMessage, guideConversation, SESSION_TTL_MS } from './handler.js'
import { CONV_TTL_MS } from './orgs.js'
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

function remember(orgId = 'o1', extra = {}) {
  store.s.sessions.set(PHONE, {
    uid: 'u1',
    orgId,
    lastOrgId: orgId,
    step: 'site',
    choiceKind: null,
    choices: [],
    choicesExpireAtMs: 0,
    expiresAtMs: NOW.getTime() + CONV_TTL_MS,
    ...extra,
  })
}

beforeEach(() => {
  sent = []
  store = fakeStore({
    links: { [PHONE]: { uid: 'u1', orgId: 'o1' } },
    users: { u1: member() },
    sites: { o1: SITES },
  })
  // The site-step tests start after the organisation has been chosen. The
  // organisation conversation is covered on its own, with the session cleared.
  remember()
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
    expect(sent[0].text).toMatch(/^Centre not found for "demo002"/)
    expect(sent[1].text).toMatch(/^Centre not found for "nope999"/)
    expect(sent[0].text).not.toMatch(/South Hub|DEMO002/)
    expect(sent[1].text).not.toMatch(/South Hub|DEMO002/)
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
    expect(sent[0].text).toMatch(/1\. Demo South Annex/)
    expect(sent[0].list).toMatchObject({ button: 'Choose centre', section: 'Centres' })
  })

  it('matches a centre name ignoring case', async () => {
    store.s.users.set('u1', member({ role: 'admin' }))
    const row = await handleMessage(msg('NORTH hub'), ctx())
    expect(row).toMatchObject({ outcome: 'ok', siteId: 's1' })
    expect(sent[0].text).toContain('Demo North Hub (DEMO001)')
  })

  it('lists at most eight centres, and a number returns the one picked', async () => {
    const hubs = Array.from({ length: 8 }, (_, i) => ({
      id: `h${i}`,
      name: `South Hub ${i}`,
      code: `H${i}`,
      region: 'South',
    }))
    store.s.sites.o1 = hubs
    store.s.users.set('u1', member({ role: 'admin' }))
    await handleMessage(msg('south hub'), ctx())
    expect(sent[0].rows).toHaveLength(8)
    expect(sent[0].text).toMatch(/1\. South Hub/)
    expect(sent[0].text).toMatch(/8\. South Hub/)
    const first = store.s.sessions.get(PHONE).choices[0]
    const row = await handleMessage(msg('1'), ctx())
    expect(row).toMatchObject({ outcome: 'ok', siteId: first })
    expect(sent[1].text).toContain(`(${hubs.find((h) => h.id === first).code})`)
  })

  it('asks for the centre id when more than eight names match', async () => {
    store.s.sites.o1 = Array.from({ length: 9 }, (_, i) => ({
      id: `h${i}`,
      name: `South Hub ${i}`,
      code: `H${i}`,
      region: 'South',
    }))
    store.s.users.set('u1', member({ role: 'admin' }))
    const row = await handleMessage(msg('south hub'), ctx())
    expect(row.outcome).toBe('ambiguous')
    expect(sent[0].rows).toBeUndefined()
    expect(sent[0].text).toContain('9 centres match')
    expect(sent[0].text).not.toContain('South Hub 0')
  })

  it('returns the one centre a fuzzy name matches', async () => {
    store.s.sites.o1 = [
      { id: 's1', name: 'Koramangala Block', code: 'BLR1', region: 'South' },
      { id: 's2', name: 'Whitefield Depot', code: 'BLR2', region: 'South' },
    ]
    store.s.users.set('u1', member({ role: 'admin' }))
    const row = await handleMessage(msg('koramangla'), ctx())
    expect(row).toMatchObject({ outcome: 'ok', siteId: 's1' })
    expect(sent[0].text).toContain('Koramangala Block (BLR1)')
    expect(sent[0].text).not.toContain('Whitefield')
  })

  it('suggests the closest name, and a number returns that centre', async () => {
    store.s.sites.o1 = [
      { id: 's3', name: 'Demo South Annex', code: 'DEMO003', region: 'South' },
      { id: 's2', name: 'Whitefield Depot', code: 'BLR2', region: 'South' },
    ]
    store.s.users.set('u1', member({ role: 'admin' }))
    const row = await handleMessage(msg('anex'), ctx())
    expect(row.outcome).toBe('nomatch')
    expect(sent[0].text).toContain('Centre not found for "anex"')
    expect(sent[0].text).toContain('Closest names:')
    expect(sent[0].text).toContain('Demo South Annex')
    expect(sent[0].text).not.toContain('Whitefield')
    expect(sent[0].rows.map((r) => r.id)).toEqual(['site:s3'])
    const picked = await handleMessage(msg('1'), ctx())
    expect(picked).toMatchObject({ outcome: 'ok', siteId: 's3' })
    expect(sent[1].text).toContain('Demo South Annex (DEMO003)')
  })

  it('asks for the centre when the organisation is already known', async () => {
    await handleMessage(msg('Hi'), ctx())
    expect(sent[0].text).toContain('Please enter the Centre ID or Centre Name.')
    expect(sent[0].text).not.toContain('Fire extinguishers')
    expect(sent[0].text).toMatch(/CHANGE ORG/)
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

  it('says the centre was not found when nothing matches', async () => {
    const row = await handleMessage(msg('zzz'), ctx())
    expect(row.outcome).toBe('nomatch')
    expect(sent[0].locationRequest).toBeUndefined()
    expect(sent[0].text).toMatch(/^Centre not found for "zzz"/)
    expect(sent[0].text).toContain('Please enter the Centre ID or Centre Name.')
    expect(sent[0].text).not.toMatch(/Demo South/)
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
    // The conversation (which organisation) outlives the numbered list.
    store.s.sessions.get(PHONE).choicesExpireAtMs = NOW.getTime() - 1
    const row = await handleMessage(msg('1'), ctx())
    expect(row.outcome).toBe('nomatch')
    expect(SESSION_TTL_MS).toBe(15 * 60 * 1000)
    expect(store.s.sessions.get(PHONE).expiresAtMs).toBeGreaterThan(NOW.getTime())
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

describe('which organisation', () => {
  const TWO = [
    { id: 'o1', name: 'Acme Fitness' },
    { id: 'o2', name: 'Beta Safety' },
  ]
  const sites = {
    o1: [{ id: 's1', name: 'Demo North Hub', code: 'DEMO001', region: 'North' }],
    o2: [{ id: 's9', name: 'Beta Central', code: 'BETA001', region: 'West' }],
  }

  beforeEach(() => store.s.sessions.clear())

  it('looks up a centre directly when the linked organisation is already known', async () => {
    store.s.sessions.clear()
    store.getOrganization = async (id) => ({ id, name: 'Acme Fitness' })
    const hi = await handleMessage(msg('hi'), ctx())
    expect(hi.outcome).toBe('orgselected')
    expect(sent[0].text).toContain('Please enter the Centre ID or Centre Name.')
    expect(sent[0].text).toMatch(/Acme Fitness/)
    expect(sent[0].text).not.toMatch(/Fire extinguishers/)

    store.s.sessions.clear()
    sent.length = 0
    const row = await handleMessage(msg('DEMO001'), ctx())
    expect(row).toMatchObject({ outcome: 'ok', siteId: 's1', orgId: 'o1' })
    expect(sent[0].text).toContain('Demo North Hub (DEMO001)')
    expect(sent[0].text).not.toMatch(/Which organisation/)
  })

  it('does not suggest a centre the linked user cannot reach', async () => {
    store.s.sessions.clear()
    store.getOrganization = async () => ({ id: 'o1', name: 'Acme Fitness' })
    const row = await handleMessage(msg('annex'), ctx())
    expect(row.outcome).toBe('nomatch')
    expect(sent[0].text).toMatch(/Centre not found/)
    expect(sent[0].text).not.toMatch(/Annex|DEMO003|South Hub/)
  })

  it('does not offer an organisation the linked user does not belong to', async () => {
    store.getOrganization = async (id) =>
      id === 'o1' ? { id, name: 'Acme Fitness' } : { id, name: 'Secret Other Co' }
    await handleMessage(msg('hi'), ctx())
    expect(JSON.stringify(sent)).not.toContain('Secret Other Co')
    expect(sent[0].text).toMatch(/Acme Fitness/)
  })

  it('CHANGE ORG asks again, and the next text is not searched as a centre', async () => {
    store.getOrganization = async () => ({ id: 'o1', name: 'Acme Fitness' })
    store.s.sessions.clear()
    await handleMessage(msg('change org'), ctx())
    expect(sent[0].text).toMatch(/Which organisation/)
    expect(sent[0].text).toMatch(/1\. Acme Fitness/)
    const row = await handleMessage(msg('DEMO001'), ctx())
    expect(row.outcome).not.toBe('ok')
    expect(sent[1].text).not.toMatch(/Fire extinguishers/)
    expect(sent[1].text).toMatch(/No organisation matches/)
  })

  it('a deleted organisation is not a way in', async () => {
    store.getOrganization = async () => null
    const row = await handleMessage(msg('DEMO001'), ctx())
    expect(row.outcome).toBe('noorgs')
    expect(sent[0].text).not.toMatch(/Fire extinguishers|DEMO001/)
  })

  it('remembers the organisation, then answers a site, until CHANGE ORG', async () => {
    store.s.sites = sites
    const guideCtx = () => ({
      store,
      now: NOW,
      from: PHONE,
      user: { uid: null, channelAdmin: true, role: 'admin', status: 'approved' },
      uid: null,
      orgs: TWO,
      listOrgs: true,
      reply: async (to, m) => {
        sent.push({ to, ...m })
        return true
      },
    })
    await guideConversation({ kind: 'greeting' }, guideCtx())
    expect(sent[0].text).toMatch(/1\. Acme Fitness/)
    expect(sent[0].text).toMatch(/2\. Beta Safety/)
    expect(sent[0].text).not.toMatch(/Fire extinguishers/)

    await guideConversation({ kind: 'site', query: 'beta' }, guideCtx())
    expect(sent[1].text).toMatch(/Beta Safety/)
    expect(sent[1].text).toContain('Please enter the Centre ID or Centre Name.')

    const row = await guideConversation({ kind: 'site', query: 'beta001' }, guideCtx())
    expect(row).toMatchObject({ outcome: 'ok', extra: { siteId: 's9', orgId: 'o2' } })
    expect(sent[2].text).toMatch(/Beta Central/)
    expect(sent[2].text).not.toMatch(/Demo North/)

    await guideConversation({ kind: 'changeOrg' }, guideCtx())
    expect(sent[3].text).toMatch(/Which organisation/)
    const again = await guideConversation({ kind: 'site', query: 'beta001' }, guideCtx())
    expect(again.outcome).not.toBe('ok')
    expect(sent[4].text).not.toMatch(/Beta Central \(BETA001\)/)
  })

  it('a closed list does not name organisations until the typed name narrows them', async () => {
    const three = [...TWO, { id: 'o3', name: 'Acme Logistics' }]
    store.s.sites = sites
    const guideCtx = () => ({
      store,
      now: NOW,
      from: PHONE,
      user: { uid: null, channelAdmin: true, role: 'admin', status: 'approved' },
      uid: null,
      orgs: three,
      listOrgs: false,
      reply: async (to, m) => {
        sent.push({ to, ...m })
        return true
      },
    })
    await guideConversation({ kind: 'greeting' }, guideCtx())
    expect(sent[0].text).not.toMatch(/Acme|Beta/)
    expect(sent[0].rows).toEqual([])

    await guideConversation({ kind: 'site', query: 'acme' }, guideCtx())
    expect(sent[1].text).toMatch(/Acme Fitness/)
    expect(sent[1].text).toMatch(/Acme Logistics/)
    expect(sent[1].text).not.toMatch(/Beta Safety/)

    await guideConversation({ kind: 'site', query: '1' }, guideCtx())
    expect(sent[2].text).toContain('Please enter the Centre ID or Centre Name.')
    expect(store.s.sessions.get(PHONE)).toMatchObject({ step: 'site', orgId: 'o1', uid: null })
  })

  it('a session for some other organisation is not a site lookup', async () => {
    remember('o2')
    store.s.sites = sites
    store.getOrganization = async () => ({ id: 'o1', name: 'Acme Fitness' })
    const row = await handleMessage(msg('BETA001'), ctx())
    expect(row.outcome).not.toBe('ok')
    expect(JSON.stringify(sent)).not.toMatch(/Beta Central/)
  })

  it('MENU after the timeout asks again, and a crafted org id outside the list is refused', async () => {
    remember('o1', { expiresAtMs: NOW.getTime() - 1 })
    store.getOrganization = async () => ({ id: 'o1', name: 'Acme Fitness' })
    const row = await handleMessage(msg('MENU'), ctx())
    expect(row.outcome).toBe('orgprompt')
    expect(row.intent).toBe('org')
    expect(sent[0].text).toMatch(/1\. Acme Fitness/)

    store.s.sessions.clear()
    const denied = await guideConversation(
      { kind: 'choice', choiceKind: 'org', orgId: 'o2' },
      {
        store,
        now: NOW,
        from: PHONE,
        user: member(),
        uid: 'u1',
        orgs: [{ id: 'o1', name: 'Acme Fitness' }],
        listOrgs: true,
        reply: async (to, m) => {
          sent.push({ to, ...m })
          return true
        },
      }
    )
    expect(denied.outcome).toBe('denied')
    expect(sent.at(-1).text).not.toMatch(/Beta|Fire extinguishers/)
  })
})

describe('organisation switch', () => {
  it('does not search sites when the organisation has turned lookup off', async () => {
    store.orgLookupEnabled = async () => false
    const row = await handleMessage(msg('DEMO001'), ctx())
    expect(row.outcome).toBe('org-off')
    expect(sent).toHaveLength(1)
    expect(sent[0].text).toContain('switched off')
    expect(sent[0].text).not.toContain('DEMO001')
    expect(sent[0].text).not.toContain('Demo North Hub')
    expect(sent[0].text).not.toContain('Fire extinguishers')
  })

  it('still unlinks when lookup is switched off', async () => {
    store.orgLookupEnabled = async () => false
    const row = await handleMessage(msg('UNLINK'), ctx())
    expect(row.outcome).toBe('unlinked')
    expect(store.s.links.has(PHONE)).toBe(false)
    expect(sent[0].text).toContain('Unlinked')
  })

  it('answers when the organisation has left lookup on', async () => {
    store.orgLookupEnabled = async () => true
    const row = await handleMessage(msg('DEMO001'), ctx())
    expect(row.outcome).toBe('ok')
    expect(sent[0].text).toContain('Demo North Hub (DEMO001)')
  })
})
