import { describe, it, expect } from 'vitest'
import {
  countQuery,
  allowUnlinkedReply,
  countBadLink,
  linkBlocked,
  countOutbound,
  windowKeys,
  LIMITS,
} from './rateLimit.js'

const at = (iso) => new Date(iso)

describe('per-user query limit', () => {
  it('allows 30 an hour, then one notice, then silence', () => {
    let state = {}
    const now = at('2026-10-12T04:10:00Z')
    for (let i = 0; i < LIMITS.perHour; i += 1) {
      const r = countQuery(state, now)
      expect(r.verdict).toBe('ok')
      state = r.state
    }
    let r = countQuery(state, now)
    expect(r.verdict).toBe('notify')
    r = countQuery(r.state, now)
    expect(r.verdict).toBe('silent')
    // Next IST hour: allowed again.
    expect(countQuery(r.state, at('2026-10-12T04:31:00Z')).verdict).toBe('ok')
  })

  it('caps the day at 150 across hours', () => {
    let state = {}
    let t = at('2026-10-11T19:00:00Z') // 00:30 IST
    let verdict = 'ok'
    let ok = 0
    for (let i = 0; i < 200; i += 1) {
      if (i % 25 === 0) t = new Date(t.getTime() + 60 * 60 * 1000)
      const r = countQuery(state, t)
      state = r.state
      verdict = r.verdict
      if (verdict === 'ok') ok += 1
    }
    expect(ok).toBe(LIMITS.perDay)
    expect(verdict).toBe('silent')
  })

  it('uses IST windows', () => {
    expect(windowKeys(at('2026-10-11T18:31:00Z'))).toEqual({
      day: '2026-10-12',
      hour: '2026-10-12T00',
    })
  })
})

describe('unknown senders', () => {
  it('get one reply per 24 hours', () => {
    const a = allowUnlinkedReply({}, at('2026-10-12T00:00:00Z'))
    expect(a.reply).toBe(true)
    expect(allowUnlinkedReply(a.state, at('2026-10-12T23:00:00Z')).reply).toBe(false)
    expect(allowUnlinkedReply(a.state, at('2026-10-13T00:00:01Z')).reply).toBe(true)
  })
})

describe('LINK guessing', () => {
  it('blocks the number for 24 hours on the fifth wrong code in a day', () => {
    let state = {}
    const now = at('2026-10-12T05:00:00Z')
    for (let i = 0; i < 4; i += 1) {
      const r = countBadLink(state, now)
      expect(r.blocked).toBe(false)
      state = r.state
    }
    const r = countBadLink(state, now)
    expect(r.blocked).toBe(true)
    expect(linkBlocked(r.state, at('2026-10-13T04:59:00Z'))).toBe(true)
    expect(linkBlocked(r.state, at('2026-10-13T05:01:00Z'))).toBe(false)
  })
})

describe('global breaker', () => {
  it('stops at the cap and resets the next IST day', () => {
    let s = { day: '2026-10-12', count: 2 }
    const now = at('2026-10-12T05:00:00Z')
    let r = countOutbound(s, now, 3)
    expect(r.allowed).toBe(true)
    r = countOutbound(r.state, now, 3)
    expect(r.allowed).toBe(false)
    expect(countOutbound(r.state, at('2026-10-12T19:00:00Z'), 3).allowed).toBe(true)
  })
})
