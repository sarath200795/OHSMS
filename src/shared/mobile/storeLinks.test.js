import { describe, expect, it } from 'vitest'
import { loadPublicStoreConfig, resolveStoreLinks, storeUrl } from './storeLinks'

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
    expect(resolveStoreLinks()).toEqual({ play: null, appStore: null })
    expect(resolveStoreLinks({ config: { playStoreUrl: '', appStoreUrl: '' } })).toEqual({
      play: null,
      appStore: null,
    })
  })

  it('uses the public config when the env vars are unset', () => {
    expect(resolveStoreLinks({ config: { playStoreUrl: PLAY, appStoreUrl: APPLE } })).toEqual({
      play: PLAY,
      appStore: APPLE,
    })
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
    expect(ok).toEqual({ playStoreUrl: PLAY, appStoreUrl: '' })
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
