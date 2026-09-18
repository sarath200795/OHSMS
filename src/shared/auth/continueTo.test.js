import { describe, it, expect } from 'vitest'
import {
  continueToFromSearch,
  continueToPath,
  locationPath,
  loginPathFor,
  withContinueTo,
} from './continueTo'

describe('continueToPath', () => {
  it('keeps a module prefix so a landing deep-link can resume', () => {
    expect(continueToPath('/equipment')).toBe('/equipment')
    expect(continueToPath('/loto')).toBe('/loto')
    expect(continueToPath('/permits')).toBe('/permits')
    expect(continueToPath('/audit')).toBe('/audit')
    expect(continueToPath('/hira/new')).toBe('/hira/new')
  })

  it('refuses auth pages, so /login?next=/login cannot loop', () => {
    expect(continueToPath('/login')).toBe('/portal')
    expect(continueToPath('/register-org')).toBe('/portal')
    expect(continueToPath('/signup')).toBe('/portal')
    expect(continueToPath('/pending')).toBe('/portal')
    expect(continueToPath('/platform')).toBe('/portal')
  })

  it('refuses the open-redirect shapes safeInternalPath refuses', () => {
    expect(continueToPath('//evil.com')).toBe('/portal')
    expect(continueToPath('/\\evil.com')).toBe('/portal')
    expect(continueToPath('https://evil.com')).toBe('/portal')
  })
})

describe('loginPathFor', () => {
  it('puts the module prefix on ?next= so the shell can send the browser back', () => {
    expect(loginPathFor({ pathname: '/equipment', search: '' })).toBe('/login?next=%2Fequipment')
    expect(loginPathFor({ pathname: '/permits', search: '?id=1' })).toBe(
      '/login?next=%2Fpermits%3Fid%3D1'
    )
  })

  it('stays on /login when there is nowhere to resume', () => {
    expect(loginPathFor({ pathname: '/login', search: '' })).toBe('/login')
    expect(loginPathFor({ pathname: '/register-org', search: '' })).toBe('/login')
  })
})

describe('continueToFromSearch / withContinueTo', () => {
  it('reads landing’s ?next= off register-org and signup', () => {
    expect(continueToFromSearch('?next=/loto')).toBe('/loto')
    expect(continueToFromSearch('next=%2Faudit')).toBe('/audit')
  })

  it('carries the destination onto the other auth pages', () => {
    expect(withContinueTo('/register-org', '/equipment')).toBe('/register-org?next=%2Fequipment')
    expect(withContinueTo('/signup', '/hira')).toBe('/signup?next=%2Fhira')
    expect(withContinueTo('/login', '/portal')).toBe('/login')
  })
})

describe('locationPath', () => {
  it('joins pathname and search', () => {
    expect(locationPath({ pathname: '/equipment', search: '' })).toBe('/equipment')
    expect(locationPath({ pathname: '/permits', search: '?x=1' })).toBe('/permits?x=1')
  })
})
