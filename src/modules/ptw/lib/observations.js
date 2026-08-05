// ─────────────────────────────────────────────────────────────────────────────
// Unanswered unsafe observations, per permit.
//
// An unsafe observation raised from a QR scan cannot touch the permit: whoever
// scanned it has no account and no permission to write there. So the link is
// made on the way out instead — count the pending unsafe reports per permit and
// hand that to the status derivation, which is what puts the flag on the list
// rather than leaving it buried on the observations page.
//
// Only unsafe and only pending counts. A safe observation is not a problem, and
// one that has been dealt with is not an open one.
// ─────────────────────────────────────────────────────────────────────────────

/** @returns Map<permitId, number of open unsafe observations> */
export function openUnsafeByPermit(observations = []) {
  const counts = new Map()
  for (const o of observations) {
    if (!o || o.type !== 'unsafe') continue
    if (!isOpen(o)) continue
    const id = o.permitId
    if (!id) continue
    counts.set(id, (counts.get(id) || 0) + 1)
  }
  return counts
}

/**
 * Is this observation still waiting on someone?
 *
 * Observations raised in the portal carry no approvalStatus at all — they acted
 * immediately, closing the permit — so a missing status means "already dealt
 * with", not "pending". Reading it the other way round would light up every
 * permit that ever had an unsafe observation, including ones already closed for
 * non-compliance.
 */
export const isOpen = (o) => o?.approvalStatus === 'pending'

/** Observations for one permit, newest first. */
export function observationsForPermit(observations = [], permitId) {
  return observations
    .filter((o) => o?.permitId === permitId)
    .sort((a, b) => millis(b?.at) - millis(a?.at))
}

function millis(v) {
  if (!v) return 0
  if (typeof v.toMillis === 'function') return v.toMillis()
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : 0
}
