import { useEffect, useState } from 'react'
import { todayISO } from './dates'

// ─────────────────────────────────────────────────────────────────────────────
// The current calendar day, as a value that changes when the day does.
//
// Derived "overdue" and "due soon" states are computed inside useMemo blocks
// whose dependencies are all DATA. That is correct for everything except the
// clock: a screen left open — and these are left open, on a wall in a control
// room — kept reporting the state it computed when the data last changed. An
// extinguisher whose refill fell due at midnight went on reading Active until
// somebody edited something unrelated.
//
// A string, not a Date, so it is stable by value: the interval below runs every
// minute, and returning the same YYYY-MM-DD means React re-renders nothing on
// the 1,439 ticks that are not midnight.
// ─────────────────────────────────────────────────────────────────────────────

/** Poll often enough to cross midnight promptly, rarely enough to cost nothing. */
const CHECK_MS = 60_000

/**
 * Today as YYYY-MM-DD, re-rendering only when the calendar day changes.
 *
 * Put it in the dependency array of any memo that derives an overdue state, and
 * the derivation rolls over on its own.
 */
export function useTodayKey(checkMs = CHECK_MS) {
  const [key, setKey] = useState(() => todayISO())
  useEffect(() => {
    const tick = () => setKey((current) => {
      const now = todayISO()
      // Same string → same reference → no re-render.
      return now === current ? current : now
    })
    // Once on mount as well as on the interval: a laptop resumed from sleep
    // fires no timers for the hours it was shut, so the first thing it does on
    // waking must be to look at the date rather than wait a minute for it.
    tick()
    const id = setInterval(tick, checkMs)
    const onWake = () => tick()
    window.addEventListener('focus', onWake)
    document.addEventListener('visibilitychange', onWake)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onWake)
      document.removeEventListener('visibilitychange', onWake)
    }
  }, [checkMs])
  return key
}
