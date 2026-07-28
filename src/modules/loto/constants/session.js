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
export const SESSION_EXPIRED_KEY = 'hecp:sessionExpired'

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
