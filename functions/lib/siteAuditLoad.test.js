import { beforeEach, describe, expect, it } from 'vitest'
import { buildDateParams, DEFAULT_RANGE_DAYS, safeRange } from './metabase.js'
import {
  clearSiteAuditCache,
  dedupeTickets,
  loadSiteAudit,
  SITE_AUDIT_CACHE_MS,
  SITE_AUDIT_FAIL_CACHE_MS,
  SITE_AUDIT_SCORE_CARD,
  SITE_AUDIT_TICKETS_CARD,
  ticketDateChunks,
} from './siteAuditLoad.js'

const NOW = Date.parse('2026-06-15T12:00:00Z')
const site = { id: 's1', name: 'Demo North Hub', code: 'DEMO001' }

const auditRow = {
  siteId: 'DEMO001',
  site: 'Demo North Hub',
  auditDate: '2026-03-02',
  passPct: 82,
  passPctN7: 91,
  status: 'closed',
  count: 1,
  auditType: '',
}

const openRow = {
  siteId: 'DEMO001',
  site: 'Demo North Hub',
  auditDate: '2026-03-02',
  status: 'open',
  count: 1,
  checkpoint: 'Exit route blocked',
  category: 'Fire',
  subCategory: '',
  auditType: '',
}

function harness(impl) {
  const calls = []
  const queryDataset = async (config, dataset, opts) => {
    calls.push({ dataset, range: opts.range, cards: config.cards, signal: opts.signal })
    return impl(dataset)
  }
  return { calls, queryDataset }
}

beforeEach(() => {
  clearSiteAuditCache()
})

describe('loadSiteAudit', () => {
  it('asks the two saved questions over the default window, scoped to the site', async () => {
    const { calls, queryDataset } = harness((dataset) => ({
      ok: true,
      capped: false,
      rows:
        dataset === 'audits'
          ? [
              auditRow,
              {
                ...auditRow,
                siteId: 'OTHER',
                site: 'Other Hub',
                passPct: 5,
                auditDate: '2026-05-01',
              },
            ]
          : [
              { ...openRow, ticketId: 't1' },
              {
                ...openRow,
                ticketId: 't2',
                siteId: 'OTHER',
                site: 'Other Hub',
                checkpoint: 'Not this centre',
              },
            ],
    }))
    const out = await loadSiteAudit({
      orgId: 'o1',
      site,
      now: NOW,
      queryDataset,
      readConfig: async () => ({
        apiKey: 'k',
        baseUrl: 'https://mb.example.com',
        cards: { audits: 1, findings: 2 },
      }),
    })
    const range = safeRange({}, NOW, DEFAULT_RANGE_DAYS)
    expect(calls.filter((c) => c.dataset === 'audits').map((c) => c.range)).toEqual([range])
    expect(calls.filter((c) => c.dataset === 'findings').map((c) => c.range)).toEqual(
      ticketDateChunks(range)
    )
    expect(calls.every((c) => c.cards.audits === SITE_AUDIT_SCORE_CARD)).toBe(true)
    expect(calls.every((c) => c.cards.findings === SITE_AUDIT_TICKETS_CARD)).toBe(true)
    expect(out).toMatchObject({
      ok: true,
      date: '2026-03-02',
      scoreOnDay: 82,
      scoreAfter7: 91,
      openTotal: 1,
      windowDays: DEFAULT_RANGE_DAYS,
    })
    expect(out.openPoints).toEqual(['Fire: Exit route blocked — Open'])
  })

  it('reuses one extract across centres, and asks again after it expires', async () => {
    const { calls, queryDataset } = harness(() => ({ ok: true, capped: false, rows: [auditRow] }))
    const readConfig = async () => ({
      apiKey: 'k',
      baseUrl: 'https://mb.example.com',
      cards: { audits: 1, findings: 2 },
    })
    const load = (now, id = 'o1') =>
      loadSiteAudit({
        orgId: id,
        site,
        now,
        queryDataset,
        readConfig,
      })
    const per = 1 + ticketDateChunks(safeRange({}, NOW, DEFAULT_RANGE_DAYS)).length
    await load(NOW)
    await load(NOW + 1000)
    expect(calls).toHaveLength(per)
    await load(NOW, 'o2')
    expect(calls).toHaveLength(per * 2)
    await load(NOW + SITE_AUDIT_CACHE_MS + 1)
    expect(calls).toHaveLength(per * 3)
  })

  it('turns a failed read into a note, and does not hammer a dead host', async () => {
    let n = 0
    const queryDataset = async () => {
      n += 1
      return { ok: false, reason: 'unreachable', message: 'Could not reach Metabase.' }
    }
    const args = {
      orgId: 'o1',
      site,
      queryDataset,
      readConfig: async () => ({
        apiKey: 'k',
        baseUrl: 'https://mb.example.com',
        cards: { audits: 1, findings: 2 },
      }),
    }
    const first = await loadSiteAudit({ ...args, now: NOW })
    const second = await loadSiteAudit({ ...args, now: NOW + 1000 })
    expect(first).toEqual({ ok: false, reason: 'unavailable' })
    expect(second).toEqual({ ok: false, reason: 'unavailable' })
    expect(n).toBe(2)
    await loadSiteAudit({ ...args, now: NOW + SITE_AUDIT_FAIL_CACHE_MS + 1 })
    expect(n).toBe(4)
  })

  it('still replies when the config read throws, and when the extract is capped', async () => {
    const thrown = await loadSiteAudit({
      orgId: 'o1',
      site,
      now: NOW,
      queryDataset: async () => {
        throw new Error('should not be asked')
      },
      readConfig: async () => {
        throw new Error('firestore')
      },
    })
    expect(thrown).toEqual({ ok: false, reason: 'unavailable' })

    clearSiteAuditCache()
    const capped = await loadSiteAudit({
      orgId: 'o1',
      site,
      now: NOW,
      readConfig: async () => ({
        apiKey: 'k',
        baseUrl: 'https://mb.example.com',
        cards: { audits: 1, findings: 2 },
      }),
      queryDataset: async (_config, dataset) =>
        dataset === 'audits'
          ? { ok: true, capped: true, rows: [auditRow] }
          : { ok: true, capped: false, rows: [{ ...openRow, passPct: null }] },
    })
    // Findings carry no pass rate, and the audit extract was truncated, so
    // there is no honest "last" score to send.
    expect(capped).toEqual({ ok: false, reason: 'capped' })
  })

  it('says when the window simply has no audit for this centre', async () => {
    const out = await loadSiteAudit({
      orgId: 'o1',
      site,
      now: NOW,
      readConfig: async () => ({
        apiKey: 'k',
        baseUrl: 'https://mb.example.com',
        cards: { audits: 1, findings: 2 },
      }),
      queryDataset: async () => ({ ok: true, capped: false, rows: [] }),
    })
    expect(out).toEqual({ ok: false, reason: 'none', windowDays: DEFAULT_RANGE_DAYS })
  })

  it('does not reuse a 90-day extract when the caller asks for 120 days', async () => {
    const { calls, queryDataset } = harness(() => ({ ok: true, capped: false, rows: [auditRow] }))
    const readConfig = async () => ({
      apiKey: 'k',
      baseUrl: 'https://mb.example.com',
      cards: { audits: 1, findings: 2 },
    })
    await loadSiteAudit({ orgId: 'o1', site, now: NOW, queryDataset, readConfig })
    const wider = await loadSiteAudit({
      orgId: 'o1',
      site,
      now: NOW,
      queryDataset,
      readConfig,
      windowDays: 120,
    })
    const narrow = 1 + ticketDateChunks(safeRange({}, NOW, DEFAULT_RANGE_DAYS)).length
    const wide = safeRange({}, NOW, 120)
    const second = calls.slice(narrow)
    expect(second.filter((call) => call.dataset === 'audits').map((call) => call.range)).toEqual([
      wide,
    ])
    expect(second.filter((call) => call.dataset === 'findings').map((call) => call.range)).toEqual(
      ticketDateChunks(wide)
    )
    expect(wider.windowDays).toBe(120)
  })

  it('binds the date parameters and leaves the optional filters unset', () => {
    // These are the parameters the two saved questions declare. The dates are
    // required. The rest are optional filters; sending them empty would
    // restrict the estate instead of leaving the clause out.
    const score = {
      parameters: [
        {
          id: 'o',
          slug: 'ownership_type',
          type: 'string/=',
          target: ['variable', ['template-tag', 'ownership_type']],
        },
        {
          id: 'c',
          slug: 'city_name',
          type: 'string/=',
          target: ['variable', ['template-tag', 'city_name']],
        },
        {
          id: 's',
          slug: 'Start',
          type: 'date/single',
          target: ['variable', ['template-tag', 'Start']],
        },
        {
          id: 'e',
          slug: 'End',
          type: 'date/single',
          target: ['variable', ['template-tag', 'End']],
        },
      ],
    }
    const tickets = {
      parameters: [
        { id: 'sd', slug: 'sd', type: 'date/single', target: ['variable', ['template-tag', 'sd']] },
        { id: 'ed', slug: 'ed', type: 'date/single', target: ['variable', ['template-tag', 'ed']] },
        {
          id: 't',
          slug: 'Tenant_type',
          type: 'string/=',
          target: ['dimension', ['template-tag', 'Tenant_type']],
        },
        {
          id: 'l1',
          slug: 'L1_tag',
          type: 'string/=',
          target: ['dimension', ['template-tag', 'L1_tag']],
        },
        {
          id: 'l2',
          slug: 'L2_Tag',
          type: 'string/=',
          target: ['dimension', ['template-tag', 'L2_Tag']],
        },
        {
          id: 'p',
          slug: 'priority',
          type: 'string/=',
          target: ['dimension', ['template-tag', 'priority']],
        },
        {
          id: 'o',
          slug: 'ownership_type',
          type: 'string/=',
          target: ['dimension', ['template-tag', 'ownership_type']],
        },
      ],
    }
    const range = { from: '2026-06-01', to: '2026-06-15' }
    expect(buildDateParams(score, range).bound.map((row) => row.slug)).toEqual(['Start', 'End'])
    expect(buildDateParams(tickets, range).bound.map((row) => row.slug)).toEqual(['sd', 'ed'])
  })

  it('logs the columns that came back, and not the host', async () => {
    const lines = []
    await loadSiteAudit({
      orgId: 'o1',
      site,
      now: NOW,
      readConfig: async () => ({
        apiKey: 'k',
        baseUrl: 'https://mb.example.com',
        cards: { audits: 1, findings: 2 },
      }),
      queryDataset: async () => ({
        ok: true,
        capped: false,
        rows: [auditRow],
        unmapped: ['Reviewer'],
      }),
      logger: {
        info(message, extra) {
          lines.push({ message, extra })
        },
      },
    })
    expect(lines).toEqual([
      {
        message: 'siteAudit: columns',
        extra: {
          orgId: 'o1',
          scoreCard: SITE_AUDIT_SCORE_CARD,
          ticketCard: SITE_AUDIT_TICKETS_CARD,
          scoreRows: 1,
          ticketRows: ticketDateChunks(safeRange({}, NOW, DEFAULT_RANGE_DAYS)).length,
          scoreCapped: false,
          ticketCapped: false,
          ticketChunks: ticketDateChunks(safeRange({}, NOW, DEFAULT_RANGE_DAYS)).length,
          scoreUnmapped: ['Reviewer'],
          ticketUnmapped: ['Reviewer'],
          scoreReason: '',
          ticketReason: '',
        },
      },
    ])
    expect(JSON.stringify(lines)).not.toContain('mb.example.com')
  })

  it('covers the window in slices no longer than 30 days, without a gap', () => {
    const range = safeRange({}, NOW, 120)
    const chunks = ticketDateChunks(range)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].from).toBe(range.from)
    expect(chunks.at(-1).to).toBe(range.to)
    for (let i = 0; i < chunks.length; i++) {
      const span =
        (Date.parse(`${chunks[i].to}T00:00:00Z`) - Date.parse(`${chunks[i].from}T00:00:00Z`)) /
        86_400_000
      expect(span).toBeLessThanOrEqual(29)
      if (i > 0) {
        const next = new Date(Date.parse(`${chunks[i - 1].to}T00:00:00Z`) + 86_400_000)
          .toISOString()
          .slice(0, 10)
        expect(chunks[i].from).toBe(next)
      }
    }
  })

  it('dedupes a ticket that appears in two slices, and caps only when a slice is capped', async () => {
    expect(
      dedupeTickets([
        { ticketId: 't1', checkpoint: 'First' },
        { ticketId: 't1', checkpoint: 'Copy' },
        { ticketId: '', checkpoint: 'No id' },
        { checkpoint: 'Also no id' },
      ]).map((row) => row.checkpoint)
    ).toEqual(['First', 'No id', 'Also no id'])

    const seen = []
    const firstFrom = ticketDateChunks(safeRange({}, NOW, 120))[0].from
    const out = await loadSiteAudit({
      orgId: 'o1',
      site,
      now: NOW,
      windowDays: 120,
      readConfig: async () => ({
        apiKey: 'k',
        baseUrl: 'https://mb.example.com',
        cards: { audits: 1, findings: 2 },
      }),
      queryDataset: async (_config, dataset, opts) => {
        seen.push(dataset)
        if (dataset === 'audits') return { ok: true, capped: false, rows: [auditRow] }
        return {
          ok: true,
          capped: opts.range.from === firstFrom,
          rows: [{ ...openRow, ticketId: 't1', auditDate: '2026-02-11' }],
        }
      },
    })
    // The score is in the audit rows, so the centre is answered. The ticket
    // list is not trusted once any slice was cut off.
    expect(out).toMatchObject({ ok: true, scoreOnDay: 82, findingsKnown: false, openTotal: 0 })
    expect(seen.filter((dataset) => dataset === 'findings').length).toBeGreaterThan(1)
  })

  it('keeps every slice when none of them is capped, and does not double a ticket', async () => {
    const out = await loadSiteAudit({
      orgId: 'o1',
      site,
      now: NOW,
      windowDays: 120,
      readConfig: async () => ({
        apiKey: 'k',
        baseUrl: 'https://mb.example.com',
        cards: { audits: 1, findings: 2 },
      }),
      queryDataset: async (_config, dataset) => {
        if (dataset === 'audits') return { ok: true, capped: false, rows: [auditRow] }
        return {
          ok: true,
          capped: false,
          rows: [
            { ...openRow, ticketId: 't1', auditDate: '2026-02-11', checkpoint: 'Raised later' },
          ],
        }
      },
    })
    expect(out).toMatchObject({ ok: true, findingsKnown: true, openTotal: 1 })
    expect(out.openPoints).toEqual(['Fire: Raised later — Open'])
  })

  it('refuses an organisation id that is not a single path segment', async () => {
    let reads = 0
    const out = await loadSiteAudit({
      orgId: 'o1/other',
      site,
      now: NOW,
      readConfig: async () => {
        reads += 1
        return null
      },
      queryDataset: async () => ({ ok: true, rows: [auditRow], capped: false }),
    })
    expect(out).toEqual({ ok: false, reason: 'unavailable' })
    expect(reads).toBe(0)
  })
})
