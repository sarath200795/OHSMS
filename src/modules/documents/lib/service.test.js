import { describe, it, expect } from 'vitest'
import { MAX, readNotice } from './service'

// ─────────────────────────────────────────────────────────────────────────────
// The library's read is CAPPED, and a capped read is indistinguishable from a
// short one — the rows come back, just not all of them.
//
// The browser survives that: a document off the end of the list is a document
// you scroll for. A COUNT does not. Pre-launch readiness divides by a fixed
// thirty-five per site, so a certificate that fell off the end is reported as
// one nobody filed, and the tab says a site is behind when it is not. Nobody
// reading the number can tell those apart, so the read has to say so.
// ─────────────────────────────────────────────────────────────────────────────

describe('readNotice', () => {
  it('says nothing while every query came back whole', () => {
    expect(readNotice(['ok'])).toBeNull()
    expect(readNotice(['ok', 'ok', 'ok'])).toBeNull()
    expect(readNotice([])).toBeNull()
  })

  it('names the cap, so the reader knows how short the figure could be', () => {
    const n = readNotice(['capped'])
    expect(n).toBeTruthy()
    expect(n.cap).toBe(MAX)
    expect(n.message).toContain(String(MAX).replace(/\B(?=(\d{3})+(?!\d))/g, ','))
  })

  // The whole point of saying it: a total built on a short read is LOW, and low
  // here reads as "this site is behind" — a number somebody acts on.
  it('warns that any total counting them is under the real figure', () => {
    expect(readNotice(['capped']).message).toMatch(/lower than the real figure/i)
    expect(readNotice(['failed']).message).toMatch(/lower than the real figure/i)
  })

  it('reports a failed query as well as a capped one', () => {
    const n = readNotice(['ok', 'failed'])
    expect(n.failed).toHaveLength(1)
    expect(n.capped).toHaveLength(0)
    expect(n.message).toMatch(/could not be loaded/i)
  })

  it('reports both when one query capped and another failed', () => {
    const n = readNotice(['capped', 'failed'])
    expect(n.capped).toHaveLength(1)
    expect(n.failed).toHaveLength(1)
  })

  // A viewer runs one query per batch of thirty sites, so a cap is per query.
  // Labelling by position keeps "siteId in (…30 ids…)" off the dashboard while
  // still saying that more than one slice was short.
  it('labels a lone query plainly and several by position', () => {
    expect(readNotice(['capped']).capped).toEqual(['documents'])
    expect(readNotice(['capped', 'capped']).capped)
      .toEqual(['documents (part 1)', 'documents (part 2)'])
  })
})
