import { describe, expect, it } from 'vitest'
import { cacheFields, readCacheDoc } from './siteAuditCacheDoc.js'
import { syncSiteAuditCaches, SITE_AUDIT_BOT_WINDOW_DAYS } from './siteAuditSync.js'

const NOW = new Date('2026-10-25T03:54:00.000Z')
const CONFIG = { apiKey: 'k', baseUrl: 'https://mb.example.com', cards: { audits: 1, findings: 2 } }

const scored = {
  ok: true,
  windowDays: 120,
  date: '2026-03-02',
  scoreOnDay: 82,
  scoreAfter7: 91,
  findingsKnown: true,
  openPoints: ['Fire: Exit route blocked'],
  openTotal: 1,
  openMore: 0,
}

describe('cacheFields', () => {
  it('stores a scored audit, and a successful empty look, and refuses a failure', () => {
    const hit = cacheFields(scored, NOW)
    expect(hit).toMatchObject({ none: false, date: '2026-03-02', scoreOnDay: 82, syncedAt: NOW })
    expect(cacheFields({ ok: false, reason: 'none', windowDays: 120 }, NOW)).toEqual({
      none: true,
      windowDays: 120,
      syncedAt: NOW,
    })
    expect(
      cacheFields({ ok: false, reason: 'unavailable', date: '2026-03-02', scoreOnDay: 99 }, NOW)
    ).toBe(null)
    expect(readCacheDoc(hit).date).toBe('2026-03-02')
    expect(readCacheDoc({ none: true, syncedAt: NOW }).none).toBe(true)
    expect(readCacheDoc({ none: false, date: '2026-03-02' })).toBeNull()
  })
})

describe('syncSiteAuditCaches', () => {
  function harness(load) {
    const written = []
    const errors = []
    const configs = { o1: CONFIG, o2: CONFIG }
    return {
      written,
      errors,
      run: (extra = {}) =>
        syncSiteAuditCaches({
          now: NOW,
          listOrgIds: async () => ['o1', 'skip', 'o2'],
          readConfig: async (orgId) => configs[orgId] || {},
          listSites: async (orgId) =>
            orgId === 'o1'
              ? [
                  { id: 's1', name: 'North' },
                  { id: 's2', name: 'South' },
                ]
              : [{ id: 's9', name: 'Beta' }],
          load,
          writeDocs: async (orgId, rows) => {
            written.push({ orgId, rows })
          },
          logger: {
            info() {},
            error(message, extra) {
              errors.push({ message, extra })
            },
          },
          ...extra,
        }),
    }
  }

  it('writes each site from one 120-day look and skips an organisation with no key', async () => {
    const seen = []
    const { written, run } = harness(async ({ orgId, site, windowDays }) => {
      seen.push({ orgId, siteId: site.id, windowDays })
      if (site.id === 's2') return { ok: false, reason: 'none', windowDays }
      return scored
    })
    const out = await run()
    expect(seen.map((row) => row.windowDays)).toEqual([
      SITE_AUDIT_BOT_WINDOW_DAYS,
      SITE_AUDIT_BOT_WINDOW_DAYS,
      SITE_AUDIT_BOT_WINDOW_DAYS,
    ])
    expect(seen.map((row) => row.orgId)).toEqual(['o1', 'o1', 'o2'])
    expect(written[0].rows[0].data).toMatchObject({ none: false, date: '2026-03-02' })
    expect(written[0].rows[1].data).toEqual({ none: true, windowDays: 120, syncedAt: NOW })
    expect(written[0].rows[1].data.date).toBeUndefined()
    expect(written[1].orgId).toBe('o2')
    expect(out.written).toBe(3)
    expect(out.kept).toBe(0)
  })

  it('keeps the previous cache when the warehouse cannot be asked, and still refreshes the next org', async () => {
    const { written, errors, run } = harness(async ({ orgId }) => {
      if (orgId === 'o1') return { ok: false, reason: 'unavailable' }
      return scored
    })
    const out = await run()
    expect(written.map((row) => row.orgId)).toEqual(['o2'])
    expect(out.kept).toBe(1)
    expect(errors.some((row) => row.extra.orgId === 'o1')).toBe(true)
    expect(JSON.stringify(errors)).not.toContain('mb.example.com')
  })

  it('does not let one thrown organisation stop the next', async () => {
    const { written, run } = harness(async ({ orgId }) => {
      if (orgId === 'o1') throw new Error('firestore down')
      return scored
    })
    const out = await run()
    expect(written.map((row) => row.orgId)).toEqual(['o2'])
    expect(out.kept).toBe(1)
    expect(out.written).toBe(1)
  })
})
