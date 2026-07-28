import { useEffect, useRef, useState } from 'react'
import { idleState, IDLE_MS, WARN_MS } from '../lib/session'

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click']

/**
 * Watch for user inactivity and drive an auto-logout warning.
 * Returns { warning, remainingMs, stayActive }.
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
      if (warningRef.current) return
      const now = Date.now()
      if (now - lastBump < 1000) return
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

  const stayActive = () => {
    lastActivityRef.current = Date.now()
    firedRef.current = false
    warningRef.current = false
    setWarning(false)
  }

  return { warning, remainingMs, stayActive }
}
