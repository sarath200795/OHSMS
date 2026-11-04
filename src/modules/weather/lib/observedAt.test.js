import { describe, expect, it } from 'vitest'
import { asOfLabel, formatObservedAt, weatherSlot } from './observedAt'

describe('formatObservedAt', () => {
  it('prints the same Asia/Kolkata label as the digest mail', () => {
    expect(formatObservedAt('2026-09-23T05:30:00.000Z')).toBe('23 Sep, 11:00 IST')
    expect(formatObservedAt('2026-09-23T11:00')).toBe('23 Sep, 16:30 IST')
    expect(asOfLabel('2026-09-23T05:30:00.000Z')).toBe('As of 23 Sep, 11:00 IST')
  })

  it('names the same six-hour slot the digest files under', () => {
    expect(weatherSlot(new Date('2026-09-25T18:30:00.000Z'))).toBe('2026-09-26T00+0530')
    expect(weatherSlot(new Date('2026-09-26T00:30:00.000Z'))).toBe('2026-09-26T06+0530')
    expect(weatherSlot(new Date('2026-09-23T06:00:00.000Z'))).toBe('2026-09-23T06+0530')
  })
})
