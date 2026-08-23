// @vitest-environment jsdom
import { idleStatus, startSession, endSession, LAST_ACTIVITY_KEY, IDLE_TIMEOUT_MS } from './sessionConstants'

const IDLE = 30 * 60_000 // 30 min
const WARN = 60_000 // 60 s

describe('idleStatus', () => {
  it('is active right after activity', () => {
    const s = idleStatus(1_000_000, 1_000_000, IDLE, WARN)
    expect(s.phase).toBe('active')
  })

  it('stays active just before the warning window', () => {
    const now = 1_000_000 + (IDLE - WARN) - 1
    expect(idleStatus(now, 1_000_000, IDLE, WARN).phase).toBe('active')
  })

  it('warns inside the warning window with the right countdown', () => {
    const now = 1_000_000 + (IDLE - WARN) + 0 // exactly at warn boundary
    const s = idleStatus(now, 1_000_000, IDLE, WARN)
    expect(s.phase).toBe('warn')
    expect(s.secondsLeft).toBe(60)
  })

  it('counts down within the warning window', () => {
    const now = 1_000_000 + IDLE - 15_000 // 15s left
    const s = idleStatus(now, 1_000_000, IDLE, WARN)
    expect(s.phase).toBe('warn')
    expect(s.secondsLeft).toBe(15)
  })

  it('expires once the timeout passes', () => {
    const now = 1_000_000 + IDLE + 5_000
    const s = idleStatus(now, 1_000_000, IDLE, WARN)
    expect(s.phase).toBe('expired')
    expect(s.secondsLeft).toBe(0)
  })
})

describe('the session clock', () => {
  beforeEach(() => localStorage.clear())

  it('starts from now, whatever the browser was carrying', () => {
    // Yesterday's session, left behind by a tab that was simply closed.
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now() - 20 * 60 * 60 * 1000))

    startSession()

    const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY))
    expect(Date.now() - last).toBeLessThan(1_000)
    // The regression this exists for: measured against the stale stamp, the
    // first tick after signing in read as expired and signed the user out
    // about a second after they got in.
    expect(idleStatus(Date.now(), last).phase).toBe('active')
  })

  it('leaves nothing behind for the next session to be measured against', () => {
    startSession()
    endSession()
    expect(localStorage.getItem(LAST_ACTIVITY_KEY)).toBeNull()
  })

  it('still expires a session that really has been idle', () => {
    startSession()
    const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY))
    expect(idleStatus(last + IDLE_TIMEOUT_MS + 1, last).phase).toBe('expired')
  })
})
