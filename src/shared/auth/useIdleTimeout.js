import { useState, useEffect, useCallback } from 'react'
import { idleStatus, IDLE_TIMEOUT_MS, IDLE_WARNING_MS, readLastActivity, writeLastActivity } from './sessionConstants'

export function useIdleTimeout() {
  const [phase, setPhase] = useState('active')
  const [remainingSeconds, setRemainingSeconds] = useState(0)

  const resetActivity = useCallback(() => {
    writeLastActivity(Date.now().toString())
    setPhase('active')
  }, [])

  useEffect(() => {
    if (!readLastActivity()) {
      writeLastActivity(Date.now().toString())
    }

    const handleActivity = () => {
      const last = parseInt(readLastActivity() || '0', 10)
      const now = Date.now()
      if (now - last > 1000) {
        writeLastActivity(now.toString())
      }
    }

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll']
    events.forEach((evt) => window.addEventListener(evt, handleActivity, { passive: true }))

    const interval = setInterval(() => {
      const last = parseInt(readLastActivity() || '0', 10)
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
