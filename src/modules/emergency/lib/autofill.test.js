import { describe, it, expect } from 'vitest'
import { isGenericHelpline, needsRealNumber, siteNeedsRefresh } from './autofill'

describe('isGenericHelpline', () => {
  it('recognises the national emergency lines', () => {
    for (const n of ['112', '100', '101', '102', '108', '999', '911']) {
      expect(isGenericHelpline(n)).toBe(true)
    }
  })

  it('ignores spacing and punctuation around them', () => {
    expect(isGenericHelpline(' 112 ')).toBe(true)
    expect(isGenericHelpline('+112')).toBe(true)
  })

  it('treats a real direct line as specific', () => {
    expect(isGenericHelpline('+44 113 254 0000')).toBe(false)
    expect(isGenericHelpline('0113 254 0000')).toBe(false)
  })

  it('is false for blanks', () => {
    expect(isGenericHelpline('')).toBe(false)
    expect(isGenericHelpline(null)).toBe(false)
    expect(isGenericHelpline(undefined)).toBe(false)
  })

  it('does not match a number that merely contains a helpline', () => {
    expect(isGenericHelpline('01126543210')).toBe(false)
  })
})

describe('needsRealNumber', () => {
  it('flags a blank number', () => {
    expect(needsRealNumber({ phone: '' })).toBe(true)
    expect(needsRealNumber({ phone: '   ' })).toBe(true)
    expect(needsRealNumber({})).toBe(true)
  })

  it('flags a helpline stored as a service line', () => {
    expect(needsRealNumber({ name: 'Nuffield Hospital', phone: '112' })).toBe(true)
  })

  it('accepts a genuine direct line', () => {
    expect(needsRealNumber({ name: 'Nuffield Hospital', phone: '0113 388 2000' })).toBe(false)
  })
})

describe('siteNeedsRefresh', () => {
  const site = { id: 's1' }

  it('is true when the site has no external contacts', () => {
    expect(siteNeedsRefresh(site, [])).toBe(true)
  })

  it('ignores internal contacts when deciding', () => {
    const contacts = [{ kind: 'internal', siteId: 's1', phone: '0113 111 2222' }]
    expect(siteNeedsRefresh(site, contacts)).toBe(true)
  })

  it('ignores contacts belonging to other sites', () => {
    const contacts = [{ kind: 'external', siteId: 's2', phone: '0113 111 2222' }]
    expect(siteNeedsRefresh(site, contacts)).toBe(true)
  })

  it('is true when any external contact carries a helpline', () => {
    const contacts = [
      { kind: 'external', siteId: 's1', phone: '0113 111 2222' },
      { kind: 'external', siteId: 's1', phone: '112' },
    ]
    expect(siteNeedsRefresh(site, contacts)).toBe(true)
  })

  it('is false once every external contact has a direct line', () => {
    const contacts = [
      { kind: 'external', siteId: 's1', phone: '0113 111 2222' },
      { kind: 'external', siteId: 's1', phone: '0117 926 1326' },
    ]
    expect(siteNeedsRefresh(site, contacts)).toBe(false)
  })
})
