// Login-page install links.
//
// Play and the App Store are config, and both are blank until those listings
// exist. The page does not show a dead badge in the meantime: Android gets
// the APK on this origin, and iPhone gets the Home Screen steps. TestFlight
// is the same shape as the store badges — omitted until a real URL is set.
//
// A build can stamp VITE_PLAY_STORE_URL / VITE_APP_STORE_URL /
// VITE_TESTFLIGHT_URL. When those are empty, public/store.json is the
// fallback a hosting deploy can fill in without rebuilding the bundle. An
// explicit env value wins even when it is not a usable URL: falling through
// to the file would hide a bad deploy behind whatever the file still said.
//
// Only the store hosts are accepted. The badge is a trusted mark. A typo or
// a javascript: value must not become a link that wears it. The APK link is
// the same rule: a path under /downloads/, or an https Firebase Storage URL.
// Anything else falls back to the hosting path rather than leaving the site.

const PLAY_HOST = 'play.google.com'
const APPLE_HOST = 'apps.apple.com'
const TESTFLIGHT_HOST = 'testflight.apple.com'

export const DEFAULT_APK_URL = '/downloads/weehs-ohsms.apk'
export const DEFAULT_APK_VERSION = '1.0'

export function storeUrl(raw, host) {
  const value = String(raw ?? '').trim()
  if (!value) return null
  let url
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (url.hostname !== host) return null
  return url.toString()
}

function pick(envValue, configValue) {
  const fromEnv = String(envValue ?? '').trim()
  if (fromEnv) return fromEnv
  return String(configValue ?? '').trim()
}

export function resolveStoreLinks({ env = {}, config = {} } = {}) {
  return {
    play: storeUrl(pick(env.VITE_PLAY_STORE_URL, config.playStoreUrl), PLAY_HOST),
    appStore: storeUrl(pick(env.VITE_APP_STORE_URL, config.appStoreUrl), APPLE_HOST),
    testFlight: storeUrl(pick(env.VITE_TESTFLIGHT_URL, config.testFlightUrl), TESTFLIGHT_HOST),
  }
}

function isHostingApkPath(value) {
  if (!value.startsWith('/downloads/')) return false
  if (value.includes('..') || value.includes('\\') || value.includes('//')) return false
  return value.endsWith('.apk')
}

/** A same-origin APK path, or an https Firebase Storage object. Otherwise null. */
export function directApkUrl(raw) {
  const value = String(raw ?? '').trim()
  if (!value) return DEFAULT_APK_URL
  if (isHostingApkPath(value)) return value
  let url
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  const host = url.hostname
  if (host === 'firebasestorage.googleapis.com' || host.endsWith('.firebasestorage.app')) {
    return url.toString()
  }
  return null
}

export function apkVersion(raw) {
  const value = String(raw ?? '').trim()
  if (/^[0-9]+(\.[0-9]+){0,3}$/.test(value)) return value
  return null
}

export function resolveApkRelease(data = {}) {
  return {
    version: apkVersion(data.version) || DEFAULT_APK_VERSION,
    url: directApkUrl(data.url) || DEFAULT_APK_URL,
  }
}

export async function loadPublicStoreConfig(fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl('/store.json')
    if (!res?.ok) return {}
    const data = await res.json()
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    return {
      playStoreUrl: data.playStoreUrl,
      appStoreUrl: data.appStoreUrl,
      testFlightUrl: data.testFlightUrl,
    }
  } catch {
    return {}
  }
}

export async function loadApkRelease(fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl('/downloads/weehs-ohsms.json')
    if (!res?.ok) return resolveApkRelease()
    const data = await res.json()
    if (!data || typeof data !== 'object' || Array.isArray(data)) return resolveApkRelease()
    return resolveApkRelease(data)
  } catch {
    return resolveApkRelease()
  }
}
