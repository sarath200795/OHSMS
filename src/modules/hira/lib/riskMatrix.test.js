import { describe, it, expect } from 'vitest'
import { riskLevel, bandFor, BANDS } from './riskMatrix'

describe('bandFor', () => {
  it('maps every score in 1–25 to exactly one band', () => {
    for (let score = 1; score <= 25; score++) {
      const hits = BANDS.filter((b) => score >= b.min && score <= b.max)
      expect(hits, `score ${score}`).toHaveLength(1)
      expect(bandFor(score).key).toBe(hits[0].key)
    }
  })
  it('returns null outside the matrix', () => {
    expect(bandFor(0)).toBeNull()
    expect(bandFor(26)).toBeNull()
  })
})

describe('riskLevel', () => {
  it('scores probability × severity', () => {
    expect(riskLevel(3, 4).score).toBe(12)
    expect(riskLevel(5, 5).score).toBe(25)
    expect(riskLevel(1, 1).score).toBe(1)
  })

  it('classifies the band boundaries', () => {
    expect(riskLevel(1, 2).label).toBe('Negligible')   // 2
    expect(riskLevel(1, 3).label).toBe('Low')          // 3
    expect(riskLevel(1, 5).label).toBe('Medium')       // 5
    expect(riskLevel(2, 5).label).toBe('Substantial')  // 10
    expect(riskLevel(3, 4).label).toBe('High')         // 12
    expect(riskLevel(5, 4).label).toBe('Critical')     // 20
  })

  it('flags acceptable vs non-acceptable at the score-6 threshold', () => {
    expect(riskLevel(2, 3).acceptable).toBe(true)    // 6
    expect(riskLevel(4, 2).acceptable).toBe(false)   // 8 — Substantial
  })

  it('bands by the product alone — the 1–5 axes are enforced by the UI', () => {
    expect(riskLevel(1, 6).score).toBe(6)            // still lands in Medium
    expect(riskLevel(6, 6)).toBeNull()               // 36 is off the matrix
  })

  it('marks only Negligible and Low as permissible', () => {
    expect(riskLevel(2, 2).permissible).toBe(true)   // 4 — Low
    expect(riskLevel(2, 3).permissible).toBe(false)  // 6 — Medium
  })

  it('carries action guidance for the band', () => {
    expect(riskLevel(5, 5).guidance).toMatch(/shall not be carried out/i)
    expect(riskLevel(1, 1).guidance).toMatch(/no risk treatment/i)
  })

  it('returns null when either axis is unset', () => {
    expect(riskLevel(0, 3)).toBeNull()
    expect(riskLevel(3, undefined)).toBeNull()
    expect(riskLevel('', '')).toBeNull()
  })
})
