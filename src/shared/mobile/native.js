// Capacitor injects `window.Capacitor` before page scripts run. The browser
// and the test runner do not, which is how the same bundle stays a website.

/** True inside the Android or iOS shell, false in a browser tab. */
export function isNativePlatform() {
  return typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() === true
}

/** 'android' | 'ios' | 'web'. */
export function nativePlatform() {
  if (!isNativePlatform()) return 'web'
  return window.Capacitor.getPlatform?.() || 'web'
}

/**
 * Which Firebase Auth persistence a platform should use.
 *
 * A browser tab uses session persistence so a shared workstation signs out
 * when the window closes. The installed app has no such moment: switching to
 * the camera or locking the phone tears the WebView down, and session
 * persistence then presents the login screen to someone standing at a
 * cylinder. Local persistence keeps that sign-in. IdleGuard still ends a
 * session that sits unused.
 */
export function persistenceForPlatform(platform) {
  return platform === 'android' || platform === 'ios' ? 'local' : 'session'
}
