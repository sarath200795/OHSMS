// @vitest-environment jsdom
//
// The host's sign-in redirect lands on `/#session=<token>`. Picking it up used
// to happen in an effect that ran after the router had already replaced the
// URL, so a valid SAML/OIDC session was discarded and the person was put back
// on /login. These pin the pickup itself; the timing is AuthProvider calling it
// during render rather than in an effect.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  adoptSessionFromHash,
  clearAccessToken,
  currentAccessToken,
  sessionUid,
} from './ownStackSession'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const token = `${b64({ alg: 'HS256' })}.${b64({ sub: 'asha@northwind.test' })}.sig`

beforeEach(() => {
  clearAccessToken()
  window.history.replaceState({}, '', '/')
})

describe('adoptSessionFromHash', () => {
  it('stores the session from the fragment and removes it from the address bar', () => {
    window.history.replaceState({}, '', `/?x=1#session=${encodeURIComponent(token)}`)
    expect(adoptSessionFromHash()).toBe(true)
    expect(currentAccessToken()).toBe(token)
    expect(sessionUid()).toBe('asha@northwind.test')
    expect(window.location.hash).toBe('')
    expect(window.location.search).toBe('?x=1')
  })

  it('leaves an existing session alone when the URL carries none', () => {
    window.history.replaceState({}, '', `/#session=${encodeURIComponent(token)}`)
    adoptSessionFromHash()
    window.history.replaceState({}, '', '/portal#section')
    expect(adoptSessionFromHash()).toBe(false)
    expect(currentAccessToken()).toBe(token)
    expect(window.location.hash).toBe('#section')
  })

  it('strips an empty session fragment without storing anything', () => {
    window.history.replaceState({}, '', '/#session=')
    expect(adoptSessionFromHash()).toBe(false)
    expect(currentAccessToken()).toBe('')
    expect(window.location.hash).toBe('')
  })
})
