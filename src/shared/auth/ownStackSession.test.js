import { afterEach, describe, expect, it } from 'vitest'
import {
  captureOwnStackSessionFromHash,
  clearAccessToken,
  currentAccessToken,
} from './ownStackSession'

afterEach(() => {
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

  it('does not read a hash on a hosted build', () => {
    const loc = { hash: '#session=header.eyJzdWIiOiJ4In0.sig', pathname: '/', search: '' }
    expect(captureOwnStackSessionFromHash(loc, { replaceState() {} })).toBe('')
    expect(currentAccessToken()).toBe('')
  })
})
