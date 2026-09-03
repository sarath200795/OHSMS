import { useState, useEffect, useCallback } from 'react'
import { idleStatus, LAST_ACTIVITY_KEY, IDLE_TIMEOUT_MS, IDLE_WARNING_MS } from './sessionConstants'

// Site storage can be blocked — private mode, a locked-down managed browser, a
// full quota — and every access below then THROWS rather than returning null.
// startSession/endSession in sessionConstants.js already wrap the identical
// calls for exactly this reason, and connectivity.js treats blocked storage as
// a supported condition, so the app knowingly runs where this happens. Here it
// was unguarded, and because the first throw is inside useEffect it unmounted
// AppChrome into the root ErrorBoundary: the whole app became "Something went
// wrong" on every page, for a session timer.
//
// Falling back to a module-level timestamp degrades the feature honestly — the
// timeout still works for this tab, it just stops being shared across tabs,
// which is the only thing localStorage was buying.
let memoryLastActivity = 0
function readLastActivity() {
  try {
    const raw = localStorage.getItem(LAST_ACTIVITY_KEY)
    if (raw !== null) return parseInt(raw, 10) || 0
  } catch { /* blocked storage — fall through to the in-memory copy */ }
  return memoryLastActivity
}
function writeLastActivity(ms) {
  memoryLastActivity = ms
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(ms))
  } catch { /* see above */ }
}

export function useIdleTimeout() {
  const [phase, setPhase] = useState('active')
  const [remainingSeconds, setRemainingSeconds] = useState(0)

  const resetActivity = useCallback(() => {
    writeLastActivity(Date.now())
    setPhase('active')
  }, [])

  useEffect(() => {
    if (!readLastActivity()) writeLastActivity(Date.now())

    const handleActivity = () => {
      const last = readLastActivity()
      const now = Date.now()
      if (now - last > 1000) writeLastActivity(now)
    }

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll']
    events.forEach((evt) => window.addEventListener(evt, handleActivity, { passive: true }))

    const interval = setInterval(() => {
      const last = readLastActivity()
      const status = idleStatus(Date.now(), last, IDLE_TIMEOUT_MS, IDLE_WARNING_MS)
      setPhase(status.phase)
      setRemainingSeconds(status.secondsLeft)
    }, 1000)

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, handleActivity))
      clearInterval(interval)
    }
  }, [])

  return {
    isWarning: phase === 'warn',
    isExpired: phase === 'expired',
    remainingSeconds,
    resetActivity,
  }
}
