// ─────────────────────────────────────────────────────────────────────────────
// The last audit for one site, fetched the way the ODIN dashboard fetches it.
//
// Same datasets (`audits` and `findings`), same default window, same
// queryDataset — including the SSRF guard inside it. The phone reply is not
// a second client of Metabase.
//
// The webhook has a short life and the warehouse question does not. A deadline
// aborts the read so the rest of the site summary still goes out; the section
// is replaced by a one-line note. A result is remembered per organisation for
// a few minutes because a conversation looks up several centres and each one
// would otherwise run the same two questions. The cache holds rows, not
// replies: every caller is filtered to the one site they already reached.
// ─────────────────────────────────────────────────────────────────────────────
import { lastSiteAudit } from './auditScore.js'
import { DEFAULT_RANGE_DAYS, normalizeConfig, safeRange } from './metabase.js'
import { queryDataset as defaultQueryDataset } from './metabaseRun.js'

/** Give up on the warehouse in time to still send the site summary. */
export const SITE_AUDIT_DEADLINE_MS = 40_000

/** A successful extract is reused across the centres in one conversation. */
export const SITE_AUDIT_CACHE_MS = 10 * 60 * 1000

/** A failure is remembered briefly so a dead host is not dialled on every message. */
export const SITE_AUDIT_FAIL_CACHE_MS = 60 * 1000

const cache = new Map()
const inflight = new Map()

export function clearSiteAuditCache() {
  cache.clear()
  inflight.clear()
}

const usable = (result) => Boolean(result?.ok && !result.capped)

function atMillis(now) {
  if (typeof now === 'number' && Number.isFinite(now)) return now
  const t = new Date(now).getTime()
  return Number.isFinite(t) ? t : Date.now()
}

function applySite(site, payload) {
  if (!payload?.fetched) return { ok: false, reason: 'unavailable' }
  const auditsUsable = usable(payload.audits)
  const findingsUsable = usable(payload.findings)
  // A capped extract is not "the last audit": the cap keeps whichever rows
  // arrived first, and that is not the latest. Treating it as a score would
  // name the wrong audit with confidence.
  if (!auditsUsable && !findingsUsable) return { ok: false, reason: 'unavailable' }
  const summary = lastSiteAudit(
    site,
    findingsUsable ? payload.findings.rows : null,
    auditsUsable ? payload.audits.rows : []
  )
  if (!summary) {
    // A capped extract was refused above, so "none" would mean we looked and
    // the centre has no scored audit. If the only copy was capped, we did not
    // look at the latest rows — say unavailable rather than "no audit".
    if (payload.audits?.capped || payload.findings?.capped) {
      return { ok: false, reason: 'unavailable' }
    }
    return { ok: false, reason: 'none', windowDays: payload.windowDays }
  }
  return { ok: true, windowDays: payload.windowDays, ...summary }
}

async function fetchOrg({ readConfig, orgId, now, queryDataset, deadlineMs, logger }) {
  const range = safeRange({}, now, DEFAULT_RANGE_DAYS)
  const config = normalizeConfig(await readConfig())
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deadlineMs)
  const query = (dataset) =>
    queryDataset(config, dataset, {
      orgId,
      range,
      signal: controller.signal,
      timeoutMs: deadlineMs,
      logger,
    })
  try {
    const [audits, findings] = await Promise.all([query('audits'), query('findings')])
    return {
      fetched: true,
      audits,
      findings,
      windowDays: DEFAULT_RANGE_DAYS,
      fresh: usable(audits) || usable(findings),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * `{ ok: true, date, scoreOnDay, scoreAfter7, openPoints, ... }` for the site,
 * `{ ok: false, reason: 'none' }` when the window has no scored audit for it,
 * or `{ ok: false, reason: 'unavailable' }` when Metabase could not be asked.
 *
 * Never throws. The reply is already being composed; this section is optional.
 */
export async function loadSiteAudit({
  readConfig,
  site,
  orgId,
  now = Date.now(),
  queryDataset = defaultQueryDataset,
  deadlineMs = SITE_AUDIT_DEADLINE_MS,
  logger,
} = {}) {
  const key = String(orgId || '')
  if (!key || key.includes('/') || typeof readConfig !== 'function') {
    return { ok: false, reason: 'unavailable' }
  }
  const at = atMillis(now)
  try {
    const hit = cache.get(key)
    if (hit && hit.expires > at) return applySite(site, hit.payload)

    let job = inflight.get(key)
    if (!job) {
      job = fetchOrg({ readConfig, orgId: key, now: at, queryDataset, deadlineMs, logger }).finally(() => {
        inflight.delete(key)
      })
      inflight.set(key, job)
    }
    const payload = await job
    cache.set(key, {
      expires: at + (payload.fresh ? SITE_AUDIT_CACHE_MS : SITE_AUDIT_FAIL_CACHE_MS),
      payload,
    })
    return applySite(site, payload)
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}
