import { describe, it, expect } from 'vitest'
import { resolveSiteQuery, MAX_CHOICES } from './resolve.js'

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

  it('asks for the code when too many match', () => {
    const many = Array.from({ length: MAX_CHOICES + 1 }, (_, i) => ({
      id: `m${i}`,
      name: `Cult Hub ${i}`,
    }))
    expect(resolveSiteQuery('hub', many)).toEqual({ status: 'tooMany', count: MAX_CHOICES + 1 })
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
