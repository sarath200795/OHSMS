import { useEffect, useRef, useState } from 'react'
import { idleState, IDLE_MS, WARN_MS } from '../lib/session'

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click']

/**
 * Watch for user inactivity and drive an auto-logout warning.
 *
 * @param idleMs   total idle time before logout
 * @param warnMs   how long before logout to show the warning
 * @param onIdle   called once when the idle limit is reached (do the logout)
 * @param enabled  when false, no listeners/timers run (e.g. logged out)
 *
 * Returns { warning, remainingMs, stayActive }.
 *  - While `warning` is true, ordinary activity does NOT reset the clock — the
 *    user must explicitly call stayActive() ("Stay signed in"). This prevents a
 *    stray mouse move on a walked-away machine from silently keeping it alive.
 */
export function useIdleTimeout({ idleMs = IDLE_MS, warnMs = WARN_MS, onIdle, enabled = true } = {}) {
  const [warning, setWarning] = useState(false)
  const [remainingMs, setRemainingMs] = useState(warnMs)
  const lastActivityRef = useRef(Date.now())
  const warningRef = useRef(false)
  const firedRef = useRef(false)
  const onIdleRef = useRef(onIdle)
  onIdleRef.current = onIdle

  useEffect(() => {
    if (!enabled) {
      setWarning(false)
      warningRef.current = false
      return undefined
    }

    lastActivityRef.current = Date.now()
    firedRef.current = false
    let lastBump = 0

    const onActivity = () => {
      // While the warning is up, ignore passive activity — require an explicit
      // "Stay signed in" click (handled by stayActive()).
      if (warningRef.current) return
      const now = Date.now()
      if (now - lastBump < 1000) return // throttle to ~1/sec
      lastBump = now
      lastActivityRef.current = now
    }

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))

    const interval = setInterval(() => {
      const { phase, remainingMs: rem } = idleState(Date.now(), lastActivityRef.current, idleMs, warnMs)
      if (phase === 'expired') {
        if (!firedRef.current) {
          firedRef.current = true
          onIdleRef.current?.()
        }
        return
      }
      if (phase === 'warn') {
        if (!warningRef.current) { warningRef.current = true; setWarning(true) }
        setRemainingMs(rem)
      } else if (warningRef.current) {
        warningRef.current = false
        setWarning(false)
      }
    }, 1000)

    return () => {
      clearInterval(interval)
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity))
    }
  }, [enabled, idleMs, warnMs])

  // Explicit keep-alive: reset the idle clock and dismiss the warning.
  const stayActive = () => {
    lastActivityRef.current = Date.now()
    firedRef.current = false
    warningRef.current = false
    setWarning(false)
  }

  return { warning, remainingMs, stayActive }
}
