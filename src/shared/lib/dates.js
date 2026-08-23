// ─────────────────────────────────────────────────────────────────────────────
// Calendar dates, in the user's own timezone.
//
// Every date the user types in this app is a CALENDAR date — the day an
// incident happened, the day a drill was run, the day a committee met. Not an
// instant. So it is formatted from local calendar fields and never through
// toISOString(), which converts to UTC: anywhere east of Greenwich that returns
// yesterday for most of the evening. `fire/lib/hpt.js` carries the same warning,
// having been bitten by it on a five-year compliance date.
//
// Five modules each declared their own `todayISO` — actions, cctv, hira,
// incidents, training. They agree today, which is luck rather than design. This
// is the one to import from; those five should migrate to it when their files
// are next opened for another reason.
// ─────────────────────────────────────────────────────────────────────────────

/** Today as YYYY-MM-DD in the browser's timezone. */
export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Is this YYYY-MM-DD after today?
 *
 * String comparison, deliberately. Both sides are zero-padded YYYY-MM-DD, which
 * sorts lexicographically exactly as it sorts chronologically, so this needs no
 * Date parsing and cannot pick up a timezone on the way through.
 *
 * An empty or malformed value is NOT future — "you have not filled this in" is a
 * different complaint, and the required-field check is the one that should make
 * it.
 */
export function isFutureDate(value, today = todayISO()) {
  if (!value || typeof value !== 'string') return false
  return value > today
}
