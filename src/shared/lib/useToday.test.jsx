// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTodayKey } from './useToday'

// Derived overdue states are computed in memos whose dependencies are all DATA,
// which is right for everything except the clock. A dashboard left open on a
// wall kept reporting the state it computed when the data last changed, so an
// extinguisher whose refill fell due at midnight went on reading Active until
// somebody edited something unrelated.

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

const at = (y, m, d, h = 9) => vi.setSystemTime(new Date(y, m, d, h))

describe('useTodayKey', () => {
  it('starts on today', () => {
    at(2026, 8, 4)
    const { result } = renderHook(() => useTodayKey())
    expect(result.current).toBe('2026-09-04')
  })

  it('does NOT change on a tick within the same day', () => {
    at(2026, 8, 4, 9)
    const { result } = renderHook(() => useTodayKey())
    const first = result.current
    act(() => { at(2026, 8, 4, 23); vi.advanceTimersByTime(60_000) })
    expect(result.current).toBe(first)
  })

  it('changes once the clock crosses midnight', () => {
    at(2026, 8, 4, 23)
    const { result } = renderHook(() => useTodayKey())
    act(() => { at(2026, 8, 5, 0); vi.advanceTimersByTime(60_000) })
    expect(result.current).toBe('2026-09-05')
  })

  it('is stable by value, so an unchanged day re-renders nothing', () => {
    at(2026, 8, 4)
    let renders = 0
    renderHook(() => { renders += 1; return useTodayKey() })
    const before = renders
    act(() => { vi.advanceTimersByTime(60_000 * 10) })
    expect(renders).toBe(before)
  })

  it('catches up on focus, without waiting for the next tick', () => {
    // A laptop asleep overnight fires no timers for the hours it was shut.
    at(2026, 8, 4, 23)
    const { result } = renderHook(() => useTodayKey())
    act(() => { at(2026, 8, 5, 8); window.dispatchEvent(new Event('focus')) })
    expect(result.current).toBe('2026-09-05')
  })

  it('stops its timer when the screen goes away', () => {
    at(2026, 8, 4)
    const clear = vi.spyOn(global, 'clearInterval')
    const { unmount } = renderHook(() => useTodayKey())
    unmount()
    expect(clear).toHaveBeenCalled()
    clear.mockRestore()
  })
})
