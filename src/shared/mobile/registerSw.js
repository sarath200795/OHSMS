import { isNativePlatform } from './native'

/**
 * Register the shell worker. Production browser only.
 *
 * The installed app already has the built files on disk. A service worker on
 * top of that origin (https://localhost, which does not change between store
 * updates) has kept a stale shell after an update. The hosted PWA is the
 * surface that loses its files when the network does.
 *
 * A refused registration — private mode, a policy — must not take the app
 * down with it. The online app does not need the worker.
 */
export function registerShellWorker() {
  if (!import.meta.env.PROD) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  if (isNativePlatform()) return
  window.addEventListener('load', () => {
    // Root path, not a hashed asset URL. See the sw input in vite.config.js:
    // the scope has to be /, and a data: URL is refused by the CSP.
    navigator.serviceWorker.register('/sw.js', { type: 'module' }).catch(() => {})
  })
}
