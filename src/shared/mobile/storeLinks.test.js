import { describe, expect, it } from 'vitest'
import {
  directApkUrl,
  loadApkRelease,
  loadPublicStoreConfig,
  resolveApkRelease,
  resolveStoreLinks,
  storeUrl,
} from './storeLinks'

const PLAY = 'https://play.google.com/store/apps/details?id=org.weehs.ohsms'
const APPLE = 'https://apps.apple.com/app/weehs-ohsms/id0000000000'

describe('storeUrl', () => {
  it('accepts only https on the real store host', () => {
    expect(storeUrl(PLAY, 'play.google.com')).toBe(PLAY)
    expect(storeUrl(APPLE, 'apps.apple.com')).toBe(APPLE)
    expect(storeUrl('', 'play.google.com')).toBeNull()
    expect(storeUrl('   ', 'play.google.com')).toBeNull()
    expect(storeUrl('not a url', 'play.google.com')).toBeNull()
    expect(storeUrl('http://play.google.com/store/apps/details?id=x', 'play.google.com')).toBeNull()
    expect(storeUrl('javascript:alert(1)', 'play.google.com')).toBeNull()
    expect(storeUrl('https://evil.com/store/apps/details?id=x', 'play.google.com')).toBeNull()
    expect(storeUrl('https://play.google.com.evil.com/store', 'play.google.com')).toBeNull()
    expect(storeUrl('https://user:pass@play.google.com/store/apps', 'play.google.com')).toBeNull()
  })
})

describe('resolveStoreLinks', () => {
  it('is empty when neither source has a listing', () => {
    expect(resolveStoreLinks()).toEqual({ play: null, appStore: null, testFlight: null })
    expect(resolveStoreLinks({ config: { playStoreUrl: '', appStoreUrl: '' } })).toEqual({
      play: null,
      appStore: null,
      testFlight: null,
    })
  })

  it('uses the public config when the env vars are unset', () => {
    expect(
      resolveStoreLinks({
        config: {
          playStoreUrl: PLAY,
          appStoreUrl: APPLE,
          testFlightUrl: 'https://testflight.apple.com/join/abc',
        },
      })
    ).toEqual({
      play: PLAY,
      appStore: APPLE,
      testFlight: 'https://testflight.apple.com/join/abc',
    })
  })

  it('rejects a TestFlight link that is not testflight.apple.com', () => {
    expect(
      resolveStoreLinks({ config: { testFlightUrl: 'https://evil.example/join/abc' } }).testFlight
    ).toBeNull()
  })

  it('lets an env value win, and does not fall through when that value is unusable', () => {
    expect(
      resolveStoreLinks({
        env: { VITE_PLAY_STORE_URL: PLAY, VITE_APP_STORE_URL: APPLE },
        config: { playStoreUrl: 'https://play.google.com/store/apps/details?id=other' },
      }).play
    ).toBe(PLAY)
    expect(
      resolveStoreLinks({
        env: { VITE_PLAY_STORE_URL: 'https://evil.example/app' },
        config: { playStoreUrl: PLAY },
      }).play
    ).toBeNull()
  })
})

describe('loadPublicStoreConfig', () => {
  it('reads the two fields and treats a failed fetch as no listing', async () => {
    const ok = await loadPublicStoreConfig(async () => ({
      ok: true,
      json: async () => ({ playStoreUrl: PLAY, appStoreUrl: '', extra: true }),
    }))
    expect(ok).toEqual({ playStoreUrl: PLAY, appStoreUrl: '', testFlightUrl: undefined })
    expect(await loadPublicStoreConfig(async () => ({ ok: false }))).toEqual({})
    expect(
      await loadPublicStoreConfig(async () => {
        throw new Error('offline')
      })
    ).toEqual({})
    expect(
      await loadPublicStoreConfig(async () => ({ ok: true, json: async () => ['nope'] }))
    ).toEqual({})
  })
})

describe('directApkUrl', () => {
  it('stays on this site or on Firebase Storage', () => {
    expect(directApkUrl('')).toBe('/downloads/weehs-ohsms.apk')
    expect(directApkUrl('/downloads/weehs-ohsms.apk')).toBe('/downloads/weehs-ohsms.apk')
    expect(directApkUrl('/downloads/../secret.apk')).toBeNull()
    expect(directApkUrl('javascript:alert(1)')).toBeNull()
    expect(directApkUrl('https://evil.example/app.apk')).toBeNull()
    const storage = 'https://firebasestorage.googleapis.com/v0/b/bucket/o/app.apk?alt=media'
    expect(directApkUrl(storage)).toBe(storage)
  })

  it('drops a bad version and a bad url back to the hosting defaults', () => {
    expect(resolveApkRelease({ version: '<script>', url: 'https://evil.example/a.apk' })).toEqual({
      version: '1.0',
      url: '/downloads/weehs-ohsms.apk',
    })
    expect(resolveApkRelease({ version: '1.2.3', url: '/downloads/weehs-ohsms.apk' })).toEqual({
      version: '1.2.3',
      url: '/downloads/weehs-ohsms.apk',
    })
  })
})

describe('loadApkRelease', () => {
  it('reads the hosted manifest and treats a failure as the default package', async () => {
    expect(
      await loadApkRelease(async () => ({
        ok: true,
        json: async () => ({ version: '1.4', url: '/downloads/weehs-ohsms.apk' }),
      }))
    ).toEqual({ version: '1.4', url: '/downloads/weehs-ohsms.apk' })
    expect(await loadApkRelease(async () => ({ ok: false }))).toEqual({
      version: '1.0',
      url: '/downloads/weehs-ohsms.apk',
    })
  })
})
