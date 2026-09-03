import { isSessionEnd } from './sessionEnd'

/**
 * The pair of callbacks every `onSnapshot` needs, in one place.
 *
 * Omitting the third argument to onSnapshot is not "no logging". Firestore
 * raises an uncaught "Error in snapshot listener" and then never calls the
 * success callback again — so a listener that fails once is a listener that is
 * dead for the life of the page. Where a module clears its `loading` flag from
 * inside the success callback (which is the pattern in every context here), the
 * screen is left on a spinner or an empty state permanently: a missing
 * composite index, a rules change, or one permission-denied during a token
 * refresh, and the module reads as "this org has no data" rather than "this
 * module could not read its data".
 *
 * Several modules already had a handler written by hand — hira's onSnapErr,
 * emergency's `() => cb([])`, documents, cctv, training. Several did not. This
 * is the same idea with one implementation, so the next listener added anywhere
 * gets it by importing rather than by remembering.
 *
 * ── Why this returns a PAIR, and tracks delivery ──────────────────────────────
 *
 * The obvious version — an error handler that just calls `cb([])` — trades one
 * bad state for a worse one. The failure it exists for is usually transient, and
 * by the time it happens the register is on screen holding real rows. Replacing
 * them with an empty list turns "these figures are a few seconds stale" into
 * "this site has no open permits", on a safety register, with nothing but a
 * console warning to say otherwise. Stale-but-real beats confidently empty.
 *
 * Before the first snapshot there is nothing to lose and a spinner to clear, so
 * `cb([])` is exactly right there. The only way to tell those two moments apart
 * is to know whether the success callback has ever run — which is why the
 * success path goes through here too.
 *
 * Usage:
 *
 *     const h = snapshotHandlers('permits', cb)
 *     return onSnapshot(q, (snap) => h.ok(snap.docs.map(toRow)), h.err)
 *
 * isSessionEnd keeps a normal sign-out quiet: dropping the auth token refuses
 * every open snapshot at once, and printing ten permission-denied warnings on
 * the way out teaches whoever reads that console to scroll past the one message
 * that, at any other moment, means a safety register is silently showing
 * nothing to somebody who should see rows.
 *
 * @param {string} label what the listener was reading, for the warning
 * @param {(rows: unknown[]) => void} cb the module's row callback
 */
export function snapshotHandlers(label, cb) {
  let delivered = false
  return {
    ok: (rows) => {
      delivered = true
      cb?.(rows)
    },
    err: (e) => {
      if (isSessionEnd(label, e)) return
      // eslint-disable-next-line no-console
      console.warn(`[OHS MS] ${label} listener error:`, e?.code || e?.message || e)
      // Only before the first success — see above.
      if (!delivered) cb?.([])
    },
  }
}
