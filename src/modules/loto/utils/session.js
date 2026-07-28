import { LAST_ACTIVITY_KEY, SESSION_EXPIRED_KEY } from '../constants/session'

// Shared (cross-tab) "last activity" timestamp, throttled so rapid events
// (mousemove/scroll) don't hammer localStorage.
let lastWrite = 0

export function logActivity(now = Date.now()) {
  if (now - lastWrite < 1000) return
  lastWrite = now
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(now))
  } catch {
    // ignore storage failures (private mode, etc.)
  }
}

export function readLastActivity() {
  try {
    const v = Number(localStorage.getItem(LAST_ACTIVITY_KEY))
    return Number.isFinite(v) && v > 0 ? v : Date.now()
  } catch {
    return Date.now()
  }
}

/** Mark that the just-ended session expired due to inactivity (read on /login). */
export function takeSessionExpiredFlag() {
  try {
    const v = localStorage.getItem(SESSION_EXPIRED_KEY)
    if (v) localStorage.removeItem(SESSION_EXPIRED_KEY)
    return Boolean(v)
  } catch {
    return false
  }
}

export function clearSessionExpiredFlag() {
  try {
    localStorage.removeItem(SESSION_EXPIRED_KEY)
  } catch {
    // ignore
  }
}
