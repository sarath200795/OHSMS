import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useIdleTimeout } from './useIdleTimeout'
import { LAST_ACTIVITY_KEY } from './sessionConstants'

// The other half of startSession's contract, and the half nothing else pins.
//
// Mounting this hook is what a page load looks like: the tab is new, the
// session is not. Only sign-in may restart the clock — if mounting stamped it
// too, a forgotten tab could hold a session open forever by reloading itself,
// and the shorter fix for the bounce-back-to-login bug was exactly that. These
// tests are here so that fix cannot be reintroduced quietly.
describe('useIdleTimeout mount', () => {
  beforeEach(() => localStorage.clear())

  it('leaves an existing timestamp alone across a page load', () => {
    const earlier = Date.now() - 5 * 60_000
    localStorage.setItem(LAST_ACTIVITY_KEY, earlier.toString())

    renderHook(() => useIdleTimeout())

    expect(localStorage.getItem(LAST_ACTIVITY_KEY)).toBe(earlier.toString())
  })

  it('does not rescue a session that has already idled past the timeout', () => {
    const longAgo = Date.now() - 20 * 60 * 60 * 1000
    localStorage.setItem(LAST_ACTIVITY_KEY, longAgo.toString())

    renderHook(() => useIdleTimeout())

    expect(Number(localStorage.getItem(LAST_ACTIVITY_KEY))).toBe(longAgo)
  })

  it('seeds a clock when the browser carries none, so no session starts expired', () => {
    // Cleared storage, private mode, a startSession that hit a full quota: with
    // no stamp at all the timer would measure against 0 and expire instantly.
    const before = Date.now()

    const { result } = renderHook(() => useIdleTimeout())

    expect(Number(localStorage.getItem(LAST_ACTIVITY_KEY))).toBeGreaterThanOrEqual(before)
    expect(result.current.isExpired).toBe(false)
  })
})
