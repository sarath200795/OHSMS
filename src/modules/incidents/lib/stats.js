// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers for the org-wide incident stats counter (organizations/{orgId}/
// meta/stats). No Firestore here — unit-testable. firestore-side application of
// these deltas (via increment()) lives in incidents.js (bumpStats).
//
// Buckets mirror the dashboard dimensions. byLifecycle changes on every step, so
// updateIncident always feeds statsDeltaFor(before, merged).
// ─────────────────────────────────────────────────────────────────────────────

// bucket field on the stats doc → field on an incident doc
export const BUCKETS = {
  bySeverity: 'severity',
  byType: 'type',
  byCategory: 'category',
  byLocation: 'location',
  byLifecycle: 'lifecycle',
}
const BUCKET_NAMES = Object.keys(BUCKETS)

export function emptyStats() {
  const s = { total: 0, nextSeq: 0 }
  for (const b of BUCKET_NAMES) s[b] = {}
  return s
}

// Is this incident counted? (soft-deleted ones are excluded everywhere)
const counts = (inc) => inc && !inc.deletedAt

function addInto(delta, inc, sign) {
  delta.total = (delta.total || 0) + sign
  for (const [bucket, field] of Object.entries(BUCKETS)) {
    const key = inc[field]
    if (!key) continue
    delta[bucket] = delta[bucket] || {}
    delta[bucket][key] = (delta[bucket][key] || 0) + sign
  }
}

/**
 * Sparse delta to apply to the stats counter for a before→after change.
 *  - create:  before falsy/uncounted, after counted   → +1 everywhere
 *  - delete:  before counted, after uncounted          → −1 everywhere
 *  - edit:    both counted                             → net per changed bucket
 * Returns null when there is no net change.
 */
export function statsDeltaFor(before, after) {
  const beforeCounts = counts(before)
  const afterCounts = counts(after)
  const delta = {}
  if (!beforeCounts && afterCounts) {
    addInto(delta, after, +1)
  } else if (beforeCounts && !afterCounts) {
    addInto(delta, before, -1)
  } else if (beforeCounts && afterCounts) {
    for (const [bucket, field] of Object.entries(BUCKETS)) {
      const a = before[field]
      const b = after[field]
      if (a === b) continue
      delta[bucket] = delta[bucket] || {}
      if (a) delta[bucket][a] = (delta[bucket][a] || 0) - 1
      if (b) delta[bucket][b] = (delta[bucket][b] || 0) + 1
    }
  }
  // Prune empty/zero
  if (!delta.total) delete delta.total
  for (const b of BUCKET_NAMES) {
    if (!delta[b]) continue
    for (const k of Object.keys(delta[b])) if (!delta[b][k]) delete delta[b][k]
    if (Object.keys(delta[b]).length === 0) delete delta[b]
  }
  return Object.keys(delta).length ? delta : null
}

/** Full recompute from a list of incidents (admin Refresh / backfill). */
export function accumulate(list = []) {
  const s = emptyStats()
  for (const inc of list) {
    if (!counts(inc)) continue
    addInto(s, inc, +1)
  }
  return s
}
