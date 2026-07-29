import { describe, it, expect } from 'vitest'
import { siteStats, linkAssets } from './siteStats'

// Names below are real values from the Cult site master and the equipment
// exports, so these cases reflect the data rather than invented shapes.
const SITES = [
  { id: 's1', name: 'Cult Gym Ameerpet', region: 'East', entity: 'FOCO' },
  { id: 's2', name: 'Cult Gym Somajiguda - Hybrid', region: 'East', entity: 'FOFO' },
  { id: 's3', name: 'Cult Gym Suchitra Road (Suchitra)', region: 'East', entity: 'FOFO' },
  { id: 's4', name: 'Pilates Circle - Banjara Hills', region: 'East', entity: 'Pilate' },
]

const roll = (site, aeds, extinguishers = []) =>
  siteStats(site, { aeds, extinguishers, links: linkAssets([...aeds, ...extinguishers], SITES) })

describe('AEDs are counted against the site they are deployed at', () => {
  // Only extinguishers were ever put through the linking pass, so AEDs still
  // carry the free-text centre name they arrived with. Comparing that to the
  // site name directly failed on the systematic "Gym" difference, and deployed
  // AEDs showed as zero on the map bubble.
  it('matches when the equipment record omits the word "Gym"', () => {
    const aeds = [{ id: 'a1', centerName: 'Cult Ameerpet' }]
    expect(roll(SITES[0], aeds).aeds).toBe(1)
  })

  it('matches through the override table when normalisation cannot', () => {
    const aeds = [{ id: 'a2', centerName: 'Cult Suchitra Hybrid' }]
    expect(roll(SITES[2], aeds).aeds).toBe(1)
    // …and specifically not the Somajiguda site, which similarity scoring picks.
    expect(roll(SITES[1], aeds).aeds).toBe(0)
  })

  it('matches an exact name', () => {
    const aeds = [{ id: 'a3', centerName: 'Pilates Circle - Banjara Hills' }]
    expect(roll(SITES[3], aeds).aeds).toBe(1)
  })

  it('prefers an explicit siteId over the name', () => {
    const aeds = [{ id: 'a4', siteId: 's2', centerName: 'Cult Ameerpet' }]
    expect(roll(SITES[1], aeds).aeds).toBe(1)
    expect(roll(SITES[0], aeds).aeds).toBe(0)
  })

  it('leaves an unrecognised centre name unattributed rather than guessing', () => {
    const aeds = [{ id: 'a5', centerName: 'Some Gym That Is Not On The Registry' }]
    for (const s of SITES) expect(roll(s, aeds).aeds).toBe(0)
  })

  it('never counts one AED against two sites in the same region', () => {
    const aeds = [{ id: 'a6', centerName: 'Cult Ameerpet', region: 'East', entity: 'FOCO' }]
    const total = SITES.reduce((sum, s) => sum + roll(s, aeds).aeds, 0)
    expect(total).toBe(1)
  })

  it('ignores soft-deleted AEDs', () => {
    const aeds = [{ id: 'a7', centerName: 'Cult Ameerpet', deletedAt: new Date() }]
    expect(roll(SITES[0], aeds).aeds).toBe(0)
  })

  it('still counts extinguishers by their stored link', () => {
    const ext = [{ id: 'e1', siteId: 's1' }, { id: 'e2', centerName: 'Cult Ameerpet' }]
    expect(roll(SITES[0], [], ext).extinguishers).toBe(2)
  })
})

describe('linkAssets', () => {
  it('resolves each asset once and skips what it cannot place', () => {
    const a = { id: 'a1', centerName: 'Cult Ameerpet' }
    const b = { id: 'a2', centerName: 'Nowhere At All' }
    const links = linkAssets([a, b], SITES)
    expect(links.get(a)).toBe('s1')
    expect(links.has(b)).toBe(false)
  })

  it('returns an empty map when the registry has not loaded yet', () => {
    expect(linkAssets([{ id: 'a1', centerName: 'Cult Ameerpet' }], []).size).toBe(0)
  })
})
