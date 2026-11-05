// First paint, before the bundle. This file exists because the hosting
// Content-Security-Policy script-src is 'self' and does not allow an inline
// script. The same bytes in index.html do not run.
try {
  if (
    window.Capacitor &&
    window.Capacitor.isNativePlatform &&
    window.Capacitor.isNativePlatform()
  ) {
    document.documentElement.classList.add('native-shell')
  }
} catch (e) {
  /* no bridge in a browser; the HTML splash still runs */
}
try {
  if (window.localStorage && localStorage.getItem('ohsms.viewMode') === 'desktop') {
    document.documentElement.classList.add('desktop-view')
  }
} catch (e) {
  /* private mode: the bundle still removes the splash once it knows */
}
window.setTimeout(function () {
  var el = document.getElementById('boot-splash')
  if (el) el.remove()
}, 8000)
