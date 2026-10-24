// Login-page store badges. The listings do not exist yet, so both sources are
// blank in the repo and the badges render as "Coming soon" rather than links.
//
// A build can stamp VITE_PLAY_STORE_URL / VITE_APP_STORE_URL. When those are
// empty, public/store.json is the fallback a hosting deploy can fill in
// without rebuilding the bundle. An explicit env value wins even when it is
// not a usable URL: falling through to the file would hide a bad deploy
// behind whatever the file still said.
//
// Only the two store hosts are accepted. The badge is a trusted mark. A typo
// or a javascript: value must not become a link that wears it.

const PLAY_HOST = 'play.google.com'
const APPLE_HOST = 'apps.apple.com'

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
  }
}

export async function loadPublicStoreConfig(fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl('/store.json')
    if (!res?.ok) return {}
    const data = await res.json()
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    return { playStoreUrl: data.playStoreUrl, appStoreUrl: data.appStoreUrl }
  } catch {
    return {}
  }
}
