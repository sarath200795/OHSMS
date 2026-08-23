// Session / inactivity-timeout configuration.
//
// After IDLE_TIMEOUT_MS of no user activity the session is ended; a warning
// modal appears IDLE_WARNING_MS before that with a "Stay signed in" option.
// Both are overridable via env for different environments.

const idleMinutes = Number(import.meta.env.VITE_SESSION_IDLE_MINUTES)
const warnSeconds = Number(import.meta.env.VITE_SESSION_WARN_SECONDS)

export const IDLE_TIMEOUT_MS = (Number.isFinite(idleMinutes) && idleMinutes > 0 ? idleMinutes : 30) * 60_000
export const IDLE_WARNING_MS = (Number.isFinite(warnSeconds) && warnSeconds > 0 ? warnSeconds : 60) * 1_000

// localStorage keys (shared across tabs in the same browser).
export const LAST_ACTIVITY_KEY = 'hecp:lastActivity'

/**
 * Start the inactivity clock. Call this where a session BEGINS — a sign-in, not
 * a page load.
 *
 * The timestamp is in localStorage so every tab shares one clock, which also
 * means it outlives the session that wrote it. Someone who signs in on Tuesday
 * therefore arrives carrying Monday's timestamp, and without this the first tick
 * after their sign-in reads a day of inactivity and signs them straight back
 * out — a login that bounces to the login screen a second later.
 *
 * Deliberately not called on a refresh or a page load: those continue a session
 * that is already running, and resetting there would let a forgotten tab hold a
 * session open indefinitely by reloading itself.
 */
export function startSession() {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString())
  } catch {
    /* private mode or a full quota — the timer still runs, it just starts at mount */
  }
}

/**
 * End it. Nothing reads a cleared key, so the next session starts from its own
 * sign-in rather than inheriting the last one's — including when that next
 * session belongs to someone else on a shared site laptop.
 */
export function endSession() {
  try {
    localStorage.removeItem(LAST_ACTIVITY_KEY)
  } catch {
    /* see above */
  }
}

/**
 * Pure idle-state calculation (no DOM/storage) so it can be unit-tested.
 * @returns {{ phase: 'active'|'warn'|'expired', secondsLeft: number }}
 *   secondsLeft is the whole seconds until logout (0 once expired).
 */
export function idleStatus(now, lastActivity, idleMs = IDLE_TIMEOUT_MS, warnMs = IDLE_WARNING_MS) {
  const idleFor = now - lastActivity
  const msLeft = idleMs - idleFor
  if (msLeft <= 0) return { phase: 'expired', secondsLeft: 0 }
  if (idleFor >= idleMs - warnMs) {
    return { phase: 'warn', secondsLeft: Math.max(0, Math.ceil(msLeft / 1000)) }
  }
  return { phase: 'active', secondsLeft: Math.ceil(msLeft / 1000) }
}
