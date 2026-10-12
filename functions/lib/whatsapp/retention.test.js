import { describe, it, expect } from 'vitest'
import { WA_RETENTION, cutoffFor, DAY_MS } from './retention.js'

describe('WhatsApp retention', () => {
  const by = Object.fromEntries(WA_RETENTION.map((e) => [e.collection, e]))
  it('keeps the query log 90 days and the ledgers no longer than they are useful', () => {
    expect(by.waQueryLog.keepMs).toBe(90 * DAY_MS)
    expect(by.waInbound.keepMs).toBe(0) // rows carry their own 7-day expiresAt
    expect(by.waLinkCodes.keepMs).toBe(0)
  })
  // Consent does not expire; only the user (or an erasure request) removes it.
  it('never sweeps waLinks', () => {
    expect(WA_RETENTION.map((e) => e.collection)).not.toContain('waLinks')
  })
  it('computes cutoffs from now', () => {
    const now = new Date('2026-10-12T00:00:00Z')
    expect(cutoffFor(by.waQueryLog, now).toISOString()).toBe('2026-07-14T00:00:00.000Z')
  })
})
