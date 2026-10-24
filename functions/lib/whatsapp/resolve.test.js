import { describe, it, expect } from 'vitest'
import { resolveSiteQuery, closestSites, MAX_CHOICES } from './resolve.js'

const sites = [
  { id: 's1', name: 'Cult Koramangala 5th Block', code: 'BLR0123' },
  { id: 's2', name: 'Cult Koramangala 1st Block', code: 'BLR0124' },
  { id: 's3', name: 'Cult Gym Ameerpet', code: '0071' },
  { id: 's4', name: 'Cult Shaikpet', code: 'HYD0200' },
  { id: 's5', name: 'Fitso Madhapur Pearl', code: 'HYD0300' },
]

describe('resolveSiteQuery', () => {
  it('matches a code first, case-insensitively, keeping leading zeros', () => {
    expect(resolveSiteQuery('blr0123', sites)).toMatchObject({
      status: 'one',
      how: 'code',
      site: { id: 's1' },
    })
    expect(resolveSiteQuery('0071', sites)).toMatchObject({ status: 'one', site: { id: 's3' } })
    expect(resolveSiteQuery('71', sites).status).not.toBe('one')
  })

  it('prefers an exact centre id over a name that merely contains it', () => {
    const mixed = [
      { id: 'name', name: 'Centre BLR0123 Annex', code: 'OTHER' },
      { id: 'code', name: 'North Hub', code: 'BLR0123' },
    ]
    expect(resolveSiteQuery('blr0123', mixed)).toMatchObject({
      status: 'one',
      how: 'code',
      site: { id: 'code' },
    })
  })

  it('matches a normalised name, ignoring "gym" and punctuation', () => {
    expect(resolveSiteQuery('cult ameerpet', sites)).toMatchObject({
      status: 'one',
      how: 'name',
      site: { id: 's3' },
    })
  })

  it('offers a list when several names contain the words', () => {
    const out = resolveSiteQuery('koramangala', sites)
    expect(out.status).toBe('many')
    expect(out.sites.map((s) => s.id).sort()).toEqual(['s1', 's2'])
  })

  it('matches a case-insensitive partial name, including the middle of a word', () => {
    expect(resolveSiteQuery('ANGALA', sites)).toMatchObject({ status: 'many', how: 'contains' })
    expect(
      resolveSiteQuery('ANGALA', sites)
        .sites.map((s) => s.id)
        .sort()
    ).toEqual(['s1', 's2'])
    expect(resolveSiteQuery('ameer', sites)).toMatchObject({
      status: 'one',
      how: 'contains',
      site: { id: 's3' },
    })
  })

  it('narrows with more words', () => {
    expect(resolveSiteQuery('koramangala 5th', sites)).toMatchObject({
      status: 'one',
      site: { id: 's1' },
    })
  })

  it('tolerates a misspelling through the fuzzy tier', () => {
    expect(resolveSiteQuery('shaikpett', sites)).toMatchObject({
      status: 'one',
      how: 'fuzzy',
      site: { id: 's4' },
    })
  })

  it('says none rather than guessing', () => {
    expect(resolveSiteQuery('zzzz', sites)).toEqual({ status: 'none' })
    expect(resolveSiteQuery('', sites)).toEqual({ status: 'none' })
    expect(resolveSiteQuery('koramangala', [])).toEqual({ status: 'none' })
  })

  it('lists at most eight matches and asks for the id beyond that', () => {
    expect(MAX_CHOICES).toBe(8)
    const eight = Array.from({ length: MAX_CHOICES }, (_, i) => ({
      id: `m${i}`,
      name: `Cult Hub ${i}`,
    }))
    const listed = resolveSiteQuery('hub', eight)
    expect(listed.status).toBe('many')
    expect(listed.sites).toHaveLength(MAX_CHOICES)
    const many = Array.from({ length: MAX_CHOICES + 1 }, (_, i) => ({
      id: `m${i}`,
      name: `Cult Hub ${i}`,
    }))
    expect(resolveSiteQuery('hub', many)).toEqual({ status: 'tooMany', count: MAX_CHOICES + 1 })
  })

  it('suggests the closest names and never a centre outside the list', () => {
    const near = closestSites('koramangla', sites)
    expect(near.map((s) => s.id).sort()).toEqual(['s1', 's2'])
    expect(
      closestSites(
        'koramangla',
        sites.filter((s) => s.id === 's4')
      )
    ).toEqual([])
    expect(closestSites('zzzz', sites)).toEqual([])
    expect(
      closestSites('demo002', [{ id: 's1', name: 'Demo North Hub', code: 'DEMO001' }])
    ).toEqual([])
  })

  // The privacy property is the caller's (it passes only reachable sites), but
  // the resolver must never reach outside the list it was given.
  it('only ever returns sites from the list it was given', () => {
    const reach = sites.filter((s) => s.id === 's2')
    expect(resolveSiteQuery('BLR0123', reach).status).not.toBe('one')
    const out = resolveSiteQuery('koramangala', reach)
    expect(out).toMatchObject({ status: 'one', site: { id: 's2' } })
  })
})
