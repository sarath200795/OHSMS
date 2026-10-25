// ─────────────────────────────────────────────────────────────────────────────
// Refresh every configured organisation's last-audit cache.
//
// The site-lookup bots do not call Metabase. A warehouse that never answered
// held the only reply until the webhook gave up, and from Cloud Functions
// that answer often never came (the connect was aborted). This run is the
// one caller. It walks organisations that actually have a Metabase key,
// asks the shared ODIN helper once per organisation over 120 days — not the
// dashboard's 90 — and writes siteAuditCache/{orgId}/sites/{siteId}.
//
// A failed look, a capped extract, or a thrown commit leaves the previous
// document. Writing `none` is different: the look succeeded and the centre
// has no scored audit, and leaving yesterday's score up would be a lie.
// One organisation failing does not stop the next.
// ─────────────────────────────────────────────────────────────────────────────
import { Timestamp } from 'firebase-admin/firestore'
import { configPath, normalizeConfig } from './metabase.js'
import { clearSiteAuditCache, loadSiteAudit } from './siteAuditLoad.js'
import { cacheFields } from './siteAuditCacheDoc.js'
import { listSnapshotOrgIds, READ_CAP } from './whatsapp/store.js'

/** The bot's window. The dashboard stays on DEFAULT_RANGE_DAYS. */
export const SITE_AUDIT_BOT_WINDOW_DAYS = 120

/** One organisation. A dead host is aborted; the previous cache stays. */
export const SITE_AUDIT_SYNC_DEADLINE_MS = 120_000

const WRITE_BATCH = 400

const noop = () => {}
const quiet = { info: noop, error: noop }

function configured(data) {
  const config = normalizeConfig(data)
  return config.sources.some((source) => source.baseUrl && source.apiKey)
}

function safeId(id) {
  return typeof id === 'string' && id.length > 0 && !id.includes('/')
}

async function defaultListSites(db, orgId) {
  const snap = await db
    .collection(`organizations/${orgId}/sites`)
    .select('name', 'code', 'region', 'entity')
    .limit(READ_CAP)
    .get()
  return snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((site) => safeId(site.id) && typeof site.name === 'string' && site.name)
}

async function defaultReadConfig(db, orgId) {
  const snap = await db.doc(configPath(orgId)).get()
  return snap.exists ? snap.data() || {} : {}
}

async function defaultWrite(db, orgId, rows) {
  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    const batch = db.batch()
    for (const row of rows.slice(i, i + WRITE_BATCH)) {
      if (!safeId(row.siteId)) continue
      const data = { ...row.data, syncedAt: Timestamp.fromDate(row.data.syncedAt) }
      batch.set(db.doc(`siteAuditCache/${orgId}/sites/${row.siteId}`), data)
    }
    await batch.commit()
  }
}

/**
 * @returns `{ written, kept }` — documents replaced, and organisations whose
 *          previous cache was left in place because this run could not see
 *          the warehouse.
 */
export async function syncSiteAuditCaches({
  db,
  now = new Date(),
  queryDataset,
  load = loadSiteAudit,
  listOrgIds,
  listSites,
  readConfig,
  writeDocs,
  logger = quiet,
  deadlineMs = SITE_AUDIT_SYNC_DEADLINE_MS,
  windowDays = SITE_AUDIT_BOT_WINDOW_DAYS,
} = {}) {
  const orgs = listOrgIds ? await listOrgIds() : await listSnapshotOrgIds(db)
  const sitesOf = listSites || ((orgId) => defaultListSites(db, orgId))
  const configOf = readConfig || ((orgId) => defaultReadConfig(db, orgId))
  const write = writeDocs || ((orgId, rows) => defaultWrite(db, orgId, rows))
  let written = 0
  let kept = 0

  for (const orgId of orgs) {
    if (!safeId(orgId)) continue
    try {
      const raw = await configOf(orgId)
      if (!configured(raw)) continue
      const sites = await sitesOf(orgId)
      if (!sites.length) continue
      // A warm instance may still remember the last run's failure. This
      // pass has its own deadline and has to ask again.
      clearSiteAuditCache()
      const rows = []
      let skipped = 0
      for (const site of sites) {
        const summary = await load({
          readConfig: async () => raw,
          site,
          orgId,
          now,
          queryDataset,
          deadlineMs,
          logger,
          windowDays,
        })
        // null means this look must not replace the previous document.
        // A centre the warehouse could not answer keeps what it had.
        const fields = cacheFields(summary, now)
        if (!fields) {
          skipped += 1
          // A count alone is not a reason. The last run left 75 sites on the
          // previous document and the log said only how many.
          logger.error('syncSiteAuditCache: site kept previous cache', {
            orgId,
            siteId: site.id,
            reason: summary?.ok ? 'unreadable' : summary?.reason || 'unavailable',
          })
          continue
        }
        rows.push({ siteId: site.id, data: fields })
      }
      if (!rows.length) {
        kept += 1
        logger.error('syncSiteAuditCache: org kept previous cache', { orgId })
        continue
      }
      await write(orgId, rows)
      written += rows.length
      if (skipped) {
        kept += 1
        logger.error('syncSiteAuditCache: some sites kept previous cache', { orgId, skipped })
      }
    } catch (err) {
      kept += 1
      logger.error('syncSiteAuditCache: org failed', {
        orgId,
        error: String(err?.message || err).slice(0, 200),
      })
    }
  }
  return { written, kept }
}
