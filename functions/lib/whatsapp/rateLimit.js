// ─────────────────────────────────────────────────────────────────────────────
// Per-number limits. Pure state transitions; the caller runs them inside a
// Firestore transaction on waRate/{phoneHash}.
//
//   linked senders    30 queries an hour, 150 a day (IST windows). Over either,
//                     ONE "slow down" reply per window, then silence — a reply
//                     to every flood message would be the flood, billed to us.
//   unknown senders   the webhook replies every time with how to get access.
//                     allowUnlinkedReply is the old one-per-day gate and is
//                     not applied there: a number that failed to match was
//                     then silent, which is how a linked handset looked dead.
//   LINK attempts     five wrong codes in a day block linking from that number
//                     for 24 hours.
//
// Every reply is a billable service message once the free tier is used, so
// "silence" is the cost control as much as the abuse control.
// ─────────────────────────────────────────────────────────────────────────────

export const LIMITS = { perHour: 30, perDay: 150 }
export const UNLINKED_REPLY_EVERY_MS = 24 * 60 * 60 * 1000
export const MAX_BAD_LINKS_PER_DAY = 5
export const LINK_BLOCK_MS = 24 * 60 * 60 * 1000

const IST_OFFSET_MS = 330 * 60 * 1000

/** Hour and day window keys on the IST clock. */
export function windowKeys(now = new Date()) {
  const iso = new Date(now.getTime() + IST_OFFSET_MS).toISOString()
  return { day: iso.slice(0, 10), hour: iso.slice(0, 13) }
}

/**
 * Count one query.
 * @returns { state, verdict: 'ok' | 'notify' | 'silent' }
 */
export function countQuery(prev = {}, now = new Date(), limits = LIMITS) {
  const { day, hour } = windowKeys(now)
  const state = { ...prev }
  if (state.hourKey !== hour) Object.assign(state, { hourKey: hour, hourCount: 0 })
  if (state.dayKey !== day) Object.assign(state, { dayKey: day, dayCount: 0 })
  const over = state.hourCount >= limits.perHour || state.dayCount >= limits.perDay
  if (!over) {
    state.hourCount += 1
    state.dayCount += 1
    return { state, verdict: 'ok' }
  }
  // Which window is exhausted decides which window the one notice is for.
  const window = state.dayCount >= limits.perDay ? `d:${day}` : `h:${hour}`
  if (state.slowNoticeFor === window) return { state, verdict: 'silent' }
  state.slowNoticeFor = window
  return { state, verdict: 'notify' }
}

/** Whether an unknown / inactive sender gets the one polite reply now. */
export function allowUnlinkedReply(prev = {}, now = new Date()) {
  const last = Number(prev.unlinkedReplyAtMs) || 0
  if (last && now.getTime() - last < UNLINKED_REPLY_EVERY_MS)
    return { state: { ...prev }, reply: false }
  return { state: { ...prev, unlinkedReplyAtMs: now.getTime() }, reply: true }
}

/** Whether this number is currently blocked from linking. */
export function linkBlocked(prev = {}, now = new Date()) {
  return (Number(prev.linkBlockedUntilMs) || 0) > now.getTime()
}

/** Record a failed LINK attempt; blocks on the fifth in a day. */
export function countBadLink(prev = {}, now = new Date()) {
  const { day } = windowKeys(now)
  const state = { ...prev }
  if (state.badLinkDay !== day) Object.assign(state, { badLinkDay: day, badLinkCount: 0 })
  state.badLinkCount += 1
  if (state.badLinkCount >= MAX_BAD_LINKS_PER_DAY)
    state.linkBlockedUntilMs = now.getTime() + LINK_BLOCK_MS
  return { state, blocked: linkBlocked(state, now) }
}

/** Global circuit breaker: outbound replies today against a cap. */
export function countOutbound(prev = {}, now = new Date(), cap = 2000) {
  const { day } = windowKeys(now)
  const state = prev.day === day ? { ...prev } : { day, count: 0, alerted: false }
  if (state.count >= cap) return { state, allowed: false }
  state.count += 1
  return { state, allowed: true }
}
