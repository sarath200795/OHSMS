// ─────────────────────────────────────────────────────────────────────────────
// The document the site-lookup bots read for one centre's last audit.
//
// siteAuditCache/{orgId}/sites/{siteId}
//
// Written by the scheduled refresh, read by the webhook through the Admin
// SDK. `none: true` is a look that succeeded and found no scored audit — the
// previous score has to go, or a centre with no recent audit keeps showing
// the one from the run before. A failed look writes nothing: this module
// returns null and the caller leaves the previous document where it is.
//
// Not a person's record. It is not in subjectData.js and nothing here is
// sealed. Open-point labels are the warehouse's observation text, the same
// words the ODIN dashboard already shows to someone who can see the site,
// and the document is keyed by the site, not by a uid. Message text is not
// stored. syncedAt is when this extract was taken, which the reply prints.
// ─────────────────────────────────────────────────────────────────────────────

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

function toDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value?.toDate === 'function') {
    const d = value.toDate()
    if (d instanceof Date && !Number.isNaN(d.getTime())) return d
  }
  if (typeof value?.seconds === 'number') {
    const d = new Date(value.seconds * 1000)
    if (!Number.isNaN(d.getTime())) return d
  }
  return null
}

/**
 * The fields to store for one site, or null when this look must not replace
 * the previous document.
 */
export function cacheFields(summary, syncedAt) {
  const at = toDate(syncedAt)
  if (!at || !summary || typeof summary !== 'object') return null
  const windowDays = Number(summary.windowDays) || 0
  if (!summary.ok) {
    if (summary.reason !== 'none') return null
    return { none: true, windowDays, syncedAt: at }
  }
  if (typeof summary.date !== 'string' || !summary.date) return null
  return {
    none: false,
    windowDays,
    syncedAt: at,
    date: summary.date,
    scoreOnDay: finite(summary.scoreOnDay),
    scoreAfter7: finite(summary.scoreAfter7),
    findingsKnown: summary.findingsKnown === true,
    openPoints: (Array.isArray(summary.openPoints) ? summary.openPoints : [])
      .map((point) => String(point).slice(0, 200))
      .slice(0, 10),
    openTotal: Math.max(0, Number(summary.openTotal) || 0),
    openMore: Math.max(0, Number(summary.openMore) || 0),
  }
}

/** The shape the reply formatter reads, or null when the document is unusable. */
export function readCacheDoc(data) {
  if (!data || typeof data !== 'object') return null
  const syncedAt = toDate(data.syncedAt)
  if (!syncedAt) return null
  if (data.none === true) return { none: true, syncedAt, windowDays: Number(data.windowDays) || 0 }
  if (data.none !== false || typeof data.date !== 'string' || !data.date) return null
  return {
    none: false,
    syncedAt,
    windowDays: Number(data.windowDays) || 0,
    date: data.date,
    scoreOnDay: finite(data.scoreOnDay),
    scoreAfter7: finite(data.scoreAfter7),
    findingsKnown: data.findingsKnown === true,
    openPoints: (Array.isArray(data.openPoints) ? data.openPoints : []).map((point) =>
      String(point)
    ),
    openTotal: Math.max(0, Number(data.openTotal) || 0),
    openMore: Math.max(0, Number(data.openMore) || 0),
  }
}
