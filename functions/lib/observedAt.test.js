import { describe, expect, it } from 'vitest'
import { asOfLabel, formatObservedAt } from './observedAt.js'

describe('formatObservedAt', () => {
  it('prints Windy UTC as the same Asia/Kolkata label the screen uses', () => {
    expect(formatObservedAt('2026-09-23T05:30:00.000Z')).toBe('23 Sep, 11:00 IST')
    expect(formatObservedAt('2026-09-23T11:00')).toBe('23 Sep, 16:30 IST')
    expect(asOfLabel('2026-09-23T05:30:00.000Z')).toBe('As of 23 Sep, 11:00 IST')
  })

  it('leaves a digest window label alone', () => {
    expect(formatObservedAt('2026-09-23 06:00-12:00 IST')).toBe('')
    expect(formatObservedAt('')).toBe('')
  })
})
