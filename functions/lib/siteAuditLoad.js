// ─────────────────────────────────────────────────────────────────────────────
// The last audit for one site, for the scheduled cache the lookup bots read.
//
// Two saved questions, not whatever cards the dashboard has configured:
// the score question (day-0 and N+7) and the ticket dump (open points).
// They are still run by queryDataset, so the URL check, the pinned DNS
// lookup and the date-parameter binding stay the one implementation.
// The default window is the dashboard's. The scheduled refresh passes 120
// days and does not change that default.
//
// The phone webhooks do not call this. A warehouse that never answered used
// to hold the only site reply for the whole deadline. The schedule is the
// caller now, and the reply reads what that run stored. A deadline still
// aborts one extract so a dead host cannot stall the rest of the run.
//
// A result is remembered per organisation AND window for a few minutes,
// because one run asks about every centre and each one would otherwise run
// the same two questions. The memory holds rows, not replies: every caller
// is filtered to the one site they already reached.
// ─────────────────────────────────────────────────────────────────────────────
import { lastSiteAudit } from './auditScore.js'
import { DEFAULT_RANGE_DAYS, MAX_RANGE_DAYS, normalizeConfig, safeRange } from './metabase.js'
import { queryDataset as defaultQueryDataset } from './metabaseRun.js'

/**
 * Dynamic FLS Audit Score v3. One row per completed audit: start date,
 * day-0 CAS score, N+7 CAS score. Date parameters are Start and End.
 * ownership_type and city_name are optional filters and are left unset,
 * so the extract is the whole estate.
 */
export const SITE_AUDIT_SCORE_CARD = 68611

/**
 * QFLS Audit Tickets Dump. One row per remediation ticket. Date parameters
 * are sd and ed. Tenant, tag, priority and ownership filters are optional
 * and are left unset.
 */
export const SITE_AUDIT_TICKETS_CARD = 80321

/**
 * The connection, with these two questions in the dataset slots queryDataset
 * already knows how to run. The saved card ids on the connection are the
 * dashboard's; the cache must not follow them, and it must not grow a second
 * HTTP client to avoid them.
 */
export function siteAuditQueryConfig(raw) {
  const config = normalizeConfig(raw)
  const cards = { audits: SITE_AUDIT_SCORE_CARD, findings: SITE_AUDIT_TICKETS_CARD }
  const sources = config.sources
    .filter((source) => source.baseUrl && source.apiKey)
    .map((source) => ({ ...source, cards }))
  return { ...config, cards, sources, baseUrl: sources[0]?.baseUrl || '' }
}

/** Give up on the warehouse in time to still send the site summary. */
export const SITE_AUDIT_DEADLINE_MS = 40_000

/** A successful extract is reused across the centres in one conversation. */
export const SITE_AUDIT_CACHE_MS = 10 * 60 * 1000

/** A failure is remembered briefly so a dead host is not dialled on every message. */
export const SITE_AUDIT_FAIL_CACHE_MS = 60 * 1000

const cache = new Map()
const inflight = new Map()

/** The dashboard window unless the caller named one safeRange will accept. */
export function auditWindowDays(windowDays) {
  const n = Math.floor(Number(windowDays))
  if (!Number.isFinite(n) || n < 1 || n > MAX_RANGE_DAYS) return DEFAULT_RANGE_DAYS
  return n
}

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
      // A truncated extract is not "no audit". Keeping the previous document
      // is the honest outcome, and the skip log has to be able to say why.
      return { ok: false, reason: 'capped' }
    }
    return { ok: false, reason: 'none', windowDays: payload.windowDays }
  }
  return { ok: true, windowDays: payload.windowDays, ...summary }
}

async function fetchOrg({ readConfig, orgId, now, queryDataset, deadlineMs, logger, windowDays }) {
  const range = safeRange({}, now, windowDays)
  const config = siteAuditQueryConfig(await readConfig())
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
    // Column names, not values. A rename that the alias table does not know
    // is why a centre comes back with a score and no tickets, and the only
    // place that shows up is this log.
    logger?.info?.('siteAudit: columns', {
      orgId,
      scoreCard: SITE_AUDIT_SCORE_CARD,
      ticketCard: SITE_AUDIT_TICKETS_CARD,
      scoreRows: audits?.rows?.length ?? 0,
      ticketRows: findings?.rows?.length ?? 0,
      scoreCapped: Boolean(audits?.capped),
      ticketCapped: Boolean(findings?.capped),
      scoreUnmapped: audits?.unmapped || [],
      ticketUnmapped: findings?.unmapped || [],
      scoreReason: audits?.ok ? '' : audits?.reason || '',
      ticketReason: findings?.ok ? '' : findings?.reason || '',
    })
    return {
      fetched: true,
      audits,
      findings,
      windowDays,
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
 * Never throws. A failed extract is `{ ok: false }`, so one organisation
 * cannot abort the rest of a refresh.
 */
export async function loadSiteAudit({
  readConfig,
  site,
  orgId,
  now = Date.now(),
  queryDataset = defaultQueryDataset,
  deadlineMs = SITE_AUDIT_DEADLINE_MS,
  logger,
  windowDays,
} = {}) {
  const days = auditWindowDays(windowDays)
  // 90 and 120 must not share an extract. The dashboard and the bot ask
  // different questions of the same organisation.
  const key = `${String(orgId || '')}:${days}`
  if (!orgId || String(orgId).includes('/') || typeof readConfig !== 'function') {
    return { ok: false, reason: 'unavailable' }
  }
  const at = atMillis(now)
  try {
    const hit = cache.get(key)
    if (hit && hit.expires > at) return applySite(site, hit.payload)

    let job = inflight.get(key)
    if (!job) {
      job = fetchOrg({
        readConfig,
        orgId: String(orgId),
        now: at,
        queryDataset,
        deadlineMs,
        logger,
        windowDays: days,
      }).finally(() => {
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
