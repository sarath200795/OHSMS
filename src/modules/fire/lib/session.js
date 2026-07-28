// ─────────────────────────────────────────────────────────────────────────────
// Session/idle constants + pure helpers (no React, no Firebase) so they're
// unit-testable and shared between the idle hook and the warning modal.
// ─────────────────────────────────────────────────────────────────────────────

// Auto-logout after this much inactivity.
export const IDLE_MS = 15 * 60 * 1000 // 15 minutes
// Show the warning modal this long before logout.
export const WARN_MS = 60 * 1000 // 1 minute

/**
 * Decide the idle phase from the elapsed-since-last-activity.
 * Pure + deterministic.
 *  - 'active'  : still within the safe window
 *  - 'warn'    : within the final WARN_MS before logout (show countdown)
 *  - 'expired' : reached the idle limit (log out)
 * remainingMs = ms left until logout (clamped ≥ 0), meaningful in 'warn'/'expired'.
 */
export function idleState(now, lastActivity, idleMs = IDLE_MS, warnMs = WARN_MS) {
  const idleFor = Math.max(0, now - lastActivity)
  const remainingMs = Math.max(0, idleMs - idleFor)
  let phase = 'active'
  if (idleFor >= idleMs) phase = 'expired'
  else if (idleFor >= idleMs - warnMs) phase = 'warn'
  return { phase, remainingMs }
}

/** Format milliseconds as m:ss (e.g. 60000 → "1:00", 5000 → "0:05", 0 → "0:00"). */
export function formatMMSS(ms) {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
