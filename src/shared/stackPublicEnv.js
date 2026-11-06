// Which public flag the page is running with.
//
// The shared Firebase bundle reads the value Vite inlined. A dedicated host
// serves the same kind of build and, after fulfillment, publishes
// window.__OHSMS_STACK__ from /stack-env.js before the module runs. The
// injection wins, so that host talks to its own gateway without a second
// compile and without VITE_DATA_DRIVER=postgres on the shared build.
//
// STACK_ENV_KEYS is the same list as PUBLIC_STACK_KEYS in stack/publicEnv.mjs.
// A key added on only one side is either published and ignored, or read and
// never published. The test compares the two lists.

export const STACK_ENV_KEYS = [
  'VITE_DATA_DRIVER',
  'VITE_DATA_GATEWAY',
  'VITE_STORAGE_DRIVER',
  'VITE_S3_PRESIGN_ENDPOINT',
  'VITE_AUTH_METHOD',
  'VITE_AUTH_ISSUER',
  'VITE_AUTH_CLIENT_ID',
  'VITE_AUTH_TOTP',
  'VITE_SUPABASE_ANON_KEY',
]

function builtValue(name) {
  // Each arm is a static import.meta.env.VITE_* read. Vite replaces those.
  // import.meta.env[name] is not replaced, and the bundle then sees nothing.
  switch (name) {
    case 'VITE_DATA_DRIVER':
      return import.meta.env.VITE_DATA_DRIVER
    case 'VITE_DATA_GATEWAY':
      return import.meta.env.VITE_DATA_GATEWAY
    case 'VITE_STORAGE_DRIVER':
      return import.meta.env.VITE_STORAGE_DRIVER
    case 'VITE_S3_PRESIGN_ENDPOINT':
      return import.meta.env.VITE_S3_PRESIGN_ENDPOINT
    case 'VITE_AUTH_METHOD':
      return import.meta.env.VITE_AUTH_METHOD
    case 'VITE_AUTH_ISSUER':
      return import.meta.env.VITE_AUTH_ISSUER
    case 'VITE_AUTH_CLIENT_ID':
      return import.meta.env.VITE_AUTH_CLIENT_ID
    case 'VITE_AUTH_TOTP':
      return import.meta.env.VITE_AUTH_TOTP
    case 'VITE_SUPABASE_ANON_KEY':
      return import.meta.env.VITE_SUPABASE_ANON_KEY
    default:
      return ''
  }
}

export function publicStackValue(name) {
  if (!STACK_ENV_KEYS.includes(name)) return ''
  const runtime = typeof globalThis !== 'undefined' ? globalThis.__OHSMS_STACK__ : undefined
  const injected = runtime && typeof runtime[name] === 'string' ? runtime[name].trim() : ''
  if (injected) return injected
  const built = builtValue(name)
  return typeof built === 'string' ? built.trim() : ''
}
