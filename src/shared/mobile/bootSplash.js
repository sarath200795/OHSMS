import { readViewChoice } from './viewMode'

// The first paint is a cream screen and the mark, in the HTML, before this
// bundle. Desktop browsers skip it (the CSS already hides it at 768px), and
// so does a phone that has chosen the desktop portal. A phone still on the
// automatic choice, and the native shells, hold it long enough to read.
// Reduced motion drops the scale and keeps a short hold: the splash is how
// you know the app started, and the movement is what was asked to stop.
//
// The native splash uses the same cream and stays up until this calls hide,
// so the handoff is one screen dissolving into the same screen. If this
// bundle never runs, index.html removes the HTML splash on its own timer.
// The native splash can outlive that — it is above the WebView, and only
// this hide() reaches it.

export const BOOT_HOLD_MS = 720
export const BOOT_FADE_MS = 280

export function bootSplashPlan({ wide, native, reduce, desktopChoice }) {
  // A phone that asked for the desktop portal should not sit on the phone
  // splash. The native shell still holds its own splash for the handoff.
  if ((wide || desktopChoice) && !native) return { show: false, holdMs: 0, fadeMs: 0 }
  if (reduce) return { show: true, holdMs: 400, fadeMs: 200 }
  return { show: true, holdMs: BOOT_HOLD_MS, fadeMs: BOOT_FADE_MS }
}

function hideNativeSplash() {
  import('@capacitor/splash-screen')
    .then(({ SplashScreen }) => SplashScreen.hide({ fadeOutDuration: 200 }))
    .catch(() => {
      // The HTML splash is already the same cream and mark. A missing plugin
      // leaves that on screen, which is the handoff the native splash was
      // covering.
    })
}

export function dismissBootSplash(doc = document, win = window) {
  const el = doc.getElementById('boot-splash')
  if (!el || el.dataset.dismissing === '1') return
  el.dataset.dismissing = '1'
  const wide = win.matchMedia?.('(min-width: 768px)')?.matches === true
  const reduce = win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
  const native = doc.documentElement.classList.contains('native-shell')
  const desktopChoice = readViewChoice() === 'desktop'
  const plan = bootSplashPlan({ wide, native, reduce, desktopChoice })
  if (!plan.show) {
    el.remove()
    return
  }
  if (native) hideNativeSplash()
  win.setTimeout(() => {
    if (!el.isConnected) return
    if (!plan.fadeMs) {
      el.remove()
      return
    }
    el.classList.add('boot-splash-out')
    win.setTimeout(() => {
      if (el.isConnected) el.remove()
    }, plan.fadeMs)
  }, plan.holdMs)
}
