import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_RANGE_DAYS, safeRange } from './metabase.js'
import { clearSiteAuditCache, loadSiteAudit, SITE_AUDIT_CACHE_MS, SITE_AUDIT_FAIL_CACHE_MS } from './siteAuditLoad.js'

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
    calls.push({ dataset, range: opts.range, signal: opts.signal })
    return impl(dataset)
  }
  return { calls, queryDataset }
}

beforeEach(() => {
  clearSiteAuditCache()
})

describe('loadSiteAudit', () => {
  it('asks for the dashboard datasets over the dashboard default window, scoped to the site', async () => {
    const { calls, queryDataset } = harness((dataset) => ({
      ok: true,
      capped: false,
      rows: dataset === 'audits'
        ? [auditRow, { ...auditRow, siteId: 'OTHER', site: 'Other Hub', passPct: 5, auditDate: '2026-05-01' }]
        : [openRow, { ...openRow, siteId: 'OTHER', site: 'Other Hub', checkpoint: 'Not this centre' }],
    }))
    const out = await loadSiteAudit({
      orgId: 'o1',
      site,
      now: NOW,
      queryDataset,
      readConfig: async () => ({ apiKey: 'k', baseUrl: 'https://mb.example.com', cards: { audits: 1, findings: 2 } }),
    })
    expect(calls.map((c) => c.dataset).sort()).toEqual(['audits', 'findings'])
    expect(calls[0].range).toEqual(safeRange({}, NOW, DEFAULT_RANGE_DAYS))
    expect(out).toMatchObject({
      ok: true,
      date: '2026-03-02',
      scoreOnDay: 82,
      scoreAfter7: 91,
      openTotal: 1,
      windowDays: DEFAULT_RANGE_DAYS,
    })
    expect(out.openPoints).toEqual(['Fire: Exit route blocked'])
  })

  it('reuses one extract across centres, and asks again after it expires', async () => {
    const { calls, queryDataset } = harness(() => ({ ok: true, capped: false, rows: [auditRow] }))
    const readConfig = async () => ({ apiKey: 'k', baseUrl: 'https://mb.example.com', cards: { audits: 1, findings: 2 } })
    const load = (now, id = 'o1') =>
      loadSiteAudit({
        orgId: id,
        site,
        now,
        queryDataset,
        readConfig,
      })
    await load(NOW)
    await load(NOW + 1000)
    expect(calls).toHaveLength(2)
    await load(NOW, 'o2')
    expect(calls).toHaveLength(4)
    await load(NOW + SITE_AUDIT_CACHE_MS + 1)
    expect(calls).toHaveLength(6)
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
      readConfig: async () => ({ apiKey: 'k', baseUrl: 'https://mb.example.com', cards: { audits: 1, findings: 2 } }),
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
      readConfig: async () => ({ apiKey: 'k', baseUrl: 'https://mb.example.com', cards: { audits: 1, findings: 2 } }),
      queryDataset: async (_config, dataset) =>
        dataset === 'audits'
          ? { ok: true, capped: true, rows: [auditRow] }
          : { ok: true, capped: false, rows: [{ ...openRow, passPct: null }] },
    })
    // Findings carry no pass rate, and the audit extract was truncated, so
    // there is no honest "last" score to send.
    expect(capped).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('says when the window simply has no audit for this centre', async () => {
    const out = await loadSiteAudit({
      orgId: 'o1',
      site,
      now: NOW,
      readConfig: async () => ({ apiKey: 'k', baseUrl: 'https://mb.example.com', cards: { audits: 1, findings: 2 } }),
      queryDataset: async () => ({ ok: true, capped: false, rows: [] }),
    })
    expect(out).toEqual({ ok: false, reason: 'none', windowDays: DEFAULT_RANGE_DAYS })
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
