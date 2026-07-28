import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IDLE_TIMEOUT_MS,
  IDLE_WARNING_MS,
  LAST_ACTIVITY_KEY,
  SESSION_EXPIRED_KEY,
  idleStatus,
} from '../constants/session'
import { logActivity, readLastActivity } from '../utils/session'

const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
  'click',
]

/**
 * Inactivity watchdog. Tracks user activity across tabs (shared via
 * localStorage), surfaces a warning before timeout, and signs the user out
 * when the idle limit is reached.
 *
 * @param {{ enabled: boolean, onExpire: () => void }} opts
 * @returns {{ warningOpen: boolean, secondsLeft: number, stayActive: () => void }}
 */
export function useIdleTimeout({ enabled, onExpire }) {
  const [warningOpen, setWarningOpen] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const warningRef = useRef(false) // mirror for use inside listeners
  const expiredRef = useRef(false)
  const onExpireRef = useRef(onExpire)
  onExpireRef.current = onExpire

  const bump = useCallback(() => {
    // While the warning is showing we ignore passive activity — the user must
    // explicitly click "Stay signed in" to extend the session.
    if (warningRef.current) return
    logActivity()
  }, [])

  const stayActive = useCallback(() => {
    warningRef.current = false
    setWarningOpen(false)
    logActivity()
  }, [])

  useEffect(() => {
    if (!enabled) {
      setWarningOpen(false)
      warningRef.current = false
      return undefined
    }

    expiredRef.current = false
    logActivity() // seed the clock on arm

    const onActivity = () => bump()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick()
    }
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('storage', onStorage)

    function onStorage(e) {
      if (e.key === LAST_ACTIVITY_KEY) tick() // another tab reported activity
    }

    function tick() {
      if (expiredRef.current) return
      const { phase, secondsLeft: left } = idleStatus(
        Date.now(),
        readLastActivity(),
        IDLE_TIMEOUT_MS,
        IDLE_WARNING_MS,
      )
      if (phase === 'expired') {
        expiredRef.current = true
        try {
          localStorage.setItem(SESSION_EXPIRED_KEY, '1')
        } catch {
          // ignore storage failures
        }
        onExpireRef.current?.()
        return
      }
      if (phase === 'warn') {
        warningRef.current = true
        setWarningOpen(true)
        setSecondsLeft(left)
      } else {
        if (warningRef.current) {
          warningRef.current = false
          setWarningOpen(false)
        }
      }
    }

    const interval = setInterval(tick, 1000)
    tick()

    return () => {
      clearInterval(interval)
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity))
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('storage', onStorage)
    }
  }, [enabled, bump])

  return { warningOpen, secondsLeft, stayActive }
}
