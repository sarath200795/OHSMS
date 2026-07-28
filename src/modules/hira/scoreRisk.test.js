import { describe, it, expect } from 'vitest'
import { scoreRisk } from './index'

describe('HIRA risk-matrix scoring', () => {
  it('multiplies likelihood × severity', () => {
    expect(scoreRisk(3, 4).riskScore).toBe(12)
    expect(scoreRisk(5, 5).riskScore).toBe(25)
  })

  it('classifies levels and tones by score band', () => {
    expect(scoreRisk(1, 2)).toMatchObject({ riskLevel: 'Low', riskTone: 'green' })
    expect(scoreRisk(2, 3)).toMatchObject({ riskLevel: 'Medium', riskTone: 'amber' })
    expect(scoreRisk(3, 4)).toMatchObject({ riskLevel: 'High', riskTone: 'red' })
    expect(scoreRisk(5, 5)).toMatchObject({ riskLevel: 'Extreme', riskTone: 'red' })
  })

  it('handles empty input', () => {
    expect(scoreRisk('', '')).toMatchObject({ riskScore: null, riskLevel: '—', riskTone: 'gray' })
  })
})
