// Session/idle constants + pure helpers (no React, no Firebase).
export const IDLE_MS = 15 * 60 * 1000 // 15 minutes
export const WARN_MS = 60 * 1000 // 1 minute

export function idleState(now, lastActivity, idleMs = IDLE_MS, warnMs = WARN_MS) {
  const idleFor = Math.max(0, now - lastActivity)
  const remainingMs = Math.max(0, idleMs - idleFor)
  let phase = 'active'
  if (idleFor >= idleMs) phase = 'expired'
  else if (idleFor >= idleMs - warnMs) phase = 'warn'
  return { phase, remainingMs }
}

export function formatMMSS(ms) {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
