// One image for every company: a dedicated host tells the app what it is at
// start-up. The shared site, which sets nothing, must keep its build values.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runtimeEnv } from './runtimeConfig'

afterEach(() => {
  delete globalThis.__OHSMS_CONFIG__
  vi.unstubAllEnvs()
})

describe('runtimeEnv', () => {
  it('uses the build value when the page sets nothing (the shared site)', () => {
    vi.stubEnv('VITE_DATA_DRIVER', 'firestore')
    expect(runtimeEnv('DATA_DRIVER')).toBe('firestore')
    expect(runtimeEnv('AUTH_METHOD')).toBe('')
  })

  it("prefers the deployment's value over the build's", () => {
    vi.stubEnv('VITE_AUTH_METHOD', 'oidc')
    globalThis.__OHSMS_CONFIG__ = { AUTH_METHOD: 'saml', DATA_DRIVER: 'postgres' }
    expect(runtimeEnv('AUTH_METHOD')).toBe('saml')
    expect(runtimeEnv('DATA_DRIVER')).toBe('postgres')
  })

  it('ignores keys outside the runtime list and values that are not strings', () => {
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'built-project')
    globalThis.__OHSMS_CONFIG__ = {
      FIREBASE_PROJECT_ID: 'someone-elses-project',
      DATA_GATEWAY: { toString: () => 'https://evil.example' },
    }
    expect(runtimeEnv('FIREBASE_PROJECT_ID')).toBe('built-project')
    expect(runtimeEnv('DATA_GATEWAY')).toBe('')
  })
})
