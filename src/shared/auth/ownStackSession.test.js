import { afterEach, describe, expect, it } from 'vitest'
import {
  captureOwnStackSessionFromHash,
  clearAccessToken,
  currentAccessToken,
  holdOwnStackSignIn,
  ownStackSignInHeld,
  resetOwnStackSignInHold,
  setAccessToken,
  shouldStartCompanySignIn,
} from './ownStackSession'

afterEach(() => {
  resetOwnStackSignInHold()
  clearAccessToken()
  delete globalThis.__OHSMS_STACK__
})

describe('captureOwnStackSessionFromHash', () => {
  it('stores the SAML session before a router navigation can drop the hash', () => {
    globalThis.__OHSMS_STACK__ = { VITE_DATA_DRIVER: 'postgres' }
    const token = 'header.eyJzdWIiOiJmb3VuZGVyQGxvY2FsLnRlc3QifQ.sig'
    let next = ''
    const loc = { hash: `#session=${token}`, pathname: '/', search: '' }
    const history = {
      replaceState: (_state, _title, url) => {
        next = url
        loc.hash = ''
      },
    }
    expect(captureOwnStackSessionFromHash(loc, history)).toBe(token)
    expect(currentAccessToken()).toBe(token)
    expect(next).toBe('/')
    expect(loc.hash).toBe('')
  })

  it('does not start another company sign-in from the signed-out login page', () => {
    const start = {
      idpStart: 'http://127.0.0.1:8787/auth/start',
      isAuthed: false,
      token: '',
      search: '',
      held: false,
    }
    expect(shouldStartCompanySignIn(start)).toBe(true)
    expect(shouldStartCompanySignIn({ ...start, search: '?signedOut=1' })).toBe(false)
    holdOwnStackSignIn()
    expect(ownStackSignInHeld()).toBe(true)
    expect(shouldStartCompanySignIn({ ...start, held: ownStackSignInHeld() })).toBe(false)
    setAccessToken('header.eyJzdWIiOiJ4In0.sig')
    expect(ownStackSignInHeld()).toBe(false)
    expect(shouldStartCompanySignIn({ ...start, token: currentAccessToken() })).toBe(false)
  })

  it('does not read a hash on a hosted build', () => {
    const loc = { hash: '#session=header.eyJzdWIiOiJ4In0.sig', pathname: '/', search: '' }
    expect(captureOwnStackSessionFromHash(loc, { replaceState() {} })).toBe('')
    expect(currentAccessToken()).toBe('')
  })
})
