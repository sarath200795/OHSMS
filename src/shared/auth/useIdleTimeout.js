import { useState, useEffect, useCallback } from 'react'
import { idleStatus, LAST_ACTIVITY_KEY, IDLE_TIMEOUT_MS, IDLE_WARNING_MS } from '../../modules/loto/constants/session'

export function useIdleTimeout() {
  const [phase, setPhase] = useState('active')
  const [remainingSeconds, setRemainingSeconds] = useState(0)

  const resetActivity = useCallback(() => {
    localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString())
    setPhase('active')
  }, [])

  useEffect(() => {
    if (!localStorage.getItem(LAST_ACTIVITY_KEY)) {
      localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString())
    }

    const handleActivity = () => {
      const last = parseInt(localStorage.getItem(LAST_ACTIVITY_KEY) || '0', 10)
      const now = Date.now()
      if (now - last > 1000) {
        localStorage.setItem(LAST_ACTIVITY_KEY, now.toString())
      }
    }

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll']
    events.forEach((evt) => window.addEventListener(evt, handleActivity, { passive: true }))

    const interval = setInterval(() => {
      const last = parseInt(localStorage.getItem(LAST_ACTIVITY_KEY) || '0', 10)
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
