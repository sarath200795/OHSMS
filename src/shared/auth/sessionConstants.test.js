import { idleStatus } from './sessionConstants'

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
