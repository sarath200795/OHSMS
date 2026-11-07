// Public flags the dedicated host may hand the browser.
//
// Vite inlines every VITE_ value into a bundle. The shared Firebase build does
// not set VITE_DATA_DRIVER=postgres. This host publishes the same names after
// fulfillment, as /stack-env.js, and only these keys. A database URL, an IdP
// certificate, or a session secret that landed in the object is dropped here
// rather than shipped to the page.

export const PUBLIC_STACK_KEYS = [
  'VITE_DATA_DRIVER',
  'VITE_DATA_GATEWAY',
  'VITE_STORAGE_DRIVER',
  'VITE_S3_PRESIGN_ENDPOINT',
  'VITE_AUTH_METHOD',
  'VITE_AUTH_ISSUER',
  'VITE_AUTH_CLIENT_ID',
  'VITE_AUTH_TOTP',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_CONTROL_PLANE',
]

export function publicStackDocument(env) {
  const out = {}
  if (!env || typeof env !== 'object') return out
  for (const key of PUBLIC_STACK_KEYS) {
    const value = env[key]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    out[key] = trimmed
  }
  return out
}

export function stackEnvSource(env) {
  const json = JSON.stringify(publicStackDocument(env)).replace(/</g, '\\u003c')
  return `window.__OHSMS_STACK__=${json}\n`
}

// script-src on the shared host is 'self' and refuses an inline script
// (index.html, firebase.json). The dedicated host adds a file URL, which that
// policy allows, and only on the HTML it serves. dist/index.html stays without
// this tag, so Firebase hosting never requests /stack-env.js.
export function injectStackEnvScript(html) {
  const tag = '<script src="/stack-env.js"></script>'
  const text = String(html || '')
  if (text.includes(tag)) return text
  if (text.includes('</head>')) return text.replace('</head>', `${tag}\n</head>`)
  return `${tag}\n${text}`
}
