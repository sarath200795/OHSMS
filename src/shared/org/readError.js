// ─────────────────────────────────────────────────────────────────────────────
// The error branch of a live listener, which is the one that gets left off.
//
// onSnapshot takes three arguments and works with two, so the third is easy to
// forget and nothing complains: the listener is registered, the happy path runs,
// and a failure has nowhere to go. 27 of this app's 65 listeners were written
// that way.
//
// What that costs is not an error message. Every module context clears its
// `loading` flag from the SUCCESS callback, so a listener that can never report
// failure is a screen that can never stop loading — and the failures in question
// are ordinary: a missing composite index, a rules deploy landing mid-session, a
// moment of permission-denied while a claim refreshes. The user's only recourse
// is to guess that a refresh might help.
//
// So the fallback matters as much as the log. Calling back with an empty list
// unblocks whatever was waiting, which is why this is a helper rather than a
// convention: `() => cb([])` written 27 times is 27 chances to write `() => {}`.
//
// What this deliberately does NOT do is pretend the read succeeded. It logs, at
// warning level, through the same isSessionEnd guard the capped-read seam uses —
// so a normal sign-out stays quiet and a real fault stays loud. Where a screen
// TOTALS what it read, an empty list is not good enough and subscribeCollections
// is the right seam: it carries 'failed' status alongside the rows and renders
// "could not be loaded at all… these numbers must not be quoted as a count".
// ─────────────────────────────────────────────────────────────────────────────
import { isSessionEnd } from '../sessionEnd'

/**
 * An onSnapshot error handler that reports the failure and unblocks the caller.
 *
 * @param label what was being read, for the log line and the sign-out check
 * @param cb    the same callback the success branch uses
 * @param fallback what to hand it — `[]` for a collection, `null` for one doc
 */
export function onReadError(label, cb, fallback = []) {
  return (err) => {
    if (!isSessionEnd(label, err)) {
      // eslint-disable-next-line no-console
      console.warn(`[OHS MS] ${label} read failed:`, err?.message || err)
    }
    cb(fallback)
  }
}
