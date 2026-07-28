// ─────────────────────────────────────────────────────────────────────────────
// Connectivity self-diagnostic. The app's sign-in can only fail with
// `auth/network-request-failed` when the browser/device cannot reach Google's
// auth servers. That is almost always something on the user's side silently
// intercepting the connection — a VPN with a broken tunnel, antivirus "HTTPS/SSL
// scanning", an ad/privacy extension, or a network firewall/proxy. These checks
// reach the real endpoints and classify the failure so we can tell the user
// exactly what's wrong instead of a vague "check your connection".
// ─────────────────────────────────────────────────────────────────────────────

// Sanitize env values (strip BOM / zero-width / quotes / whitespace) — a BOM
// injected by a deploy pipeline corrupts these and is exactly what we're testing.
const clean = (v) => (v == null ? '' : String(v).replace(/[​-‍﻿]/g, '').replace(/^["']|["']$/g, '').trim())
const API_KEY = clean(import.meta.env.VITE_FIREBASE_API_KEY)
const PROJECT_ID = clean(import.meta.env.VITE_FIREBASE_PROJECT_ID)

// Fetch a URL with a hard timeout. We distinguish three outcomes:
//  - reachable: we got ANY HTTP response (even 400/401/403) → the path works.
//  - timeout:   the request hung past the deadline → a VPN / antivirus / firewall
//               is swallowing the connection (the classic "pending forever").
//  - blocked:   fetch threw quickly (TypeError) → an extension / ad-blocker
//               killed it, or DNS failed.
async function probe(url, init, timeoutMs = 8000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const start = (performance?.now?.() ?? 0)
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal })
    return { state: 'reachable', status: r.status, ms: Math.round((performance?.now?.() ?? 0) - start) }
  } catch (e) {
    const ms = Math.round((performance?.now?.() ?? 0) - start)
    if (e?.name === 'AbortError') return { state: 'timeout', ms }
    return { state: 'blocked', detail: e?.message || String(e), ms }
  } finally {
    clearTimeout(timer)
  }
}

function storageCheck() {
  const out = { sessionStorage: false, indexedDB: false, detail: '' }
  try {
    const k = '__ira_probe__'
    window.sessionStorage.setItem(k, '1')
    window.sessionStorage.removeItem(k)
    out.sessionStorage = true
  } catch (e) { out.detail = 'sessionStorage blocked' }
  try {
    out.indexedDB = typeof window.indexedDB !== 'undefined' && window.indexedDB !== null
  } catch (e) { out.detail += (out.detail ? '; ' : '') + 'indexedDB blocked' }
  return out
}

// Map a probe result to a user-facing check row.
function classify(name, res, { reachableHint, timeoutHint, blockedHint } = {}) {
  if (res.state === 'reachable') {
    return { name, ok: true, label: `Reachable (HTTP ${res.status}, ${res.ms} ms)`, hint: reachableHint || '' }
  }
  if (res.state === 'timeout') {
    return { name, ok: false, kind: 'timeout', label: `No response — the connection hung (timed out after ${res.ms} ms)`, hint: timeoutHint }
  }
  return { name, ok: false, kind: 'blocked', label: `Request was blocked (${res.detail})`, hint: blockedHint }
}

/**
 * Run all connectivity checks. Returns { checks: [...], verdict, advice }.
 * Each check: { name, ok, kind?, label, hint }.
 */
export async function runConnectivityChecks() {
  // 1) Google auth backend — the exact endpoint Firebase sign-in posts to.
  const auth = await probe(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'probe@connectivity.test', password: 'x', returnSecureToken: true }) }
  )
  // 2) Firestore REST — where incident/illness data lives.
  const firestore = await probe(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/orgIndex/__connectivity_probe__`,
    { method: 'GET' }
  )
  // 3) Plain internet sanity check (a non-Google host) — tells us if it's
  //    Google specifically being intercepted vs. the whole connection being down.
  const internet = await probe('https://vercel.com/favicon.ico', { method: 'GET', mode: 'no-cors' }, 8000)

  const store = storageCheck()

  const VPN_AV_HINT = 'A VPN, antivirus "HTTPS/SSL scanning", or a network firewall is silently swallowing the connection to Google. Fix: disconnect your VPN (e.g. ExpressVPN), turn off antivirus web/HTTPS scanning (or allow *.googleapis.com), or switch network (e.g. a phone hotspot).'
  const BLOCK_HINT = 'A browser extension (ad/privacy blocker) or DNS is blocking Google. Fix: open an Incognito window with extensions disabled, pause your ad-blocker/Shields for this site, or switch network.'

  const checks = [
    classify('Google sign-in (identitytoolkit.googleapis.com)', auth, { reachableHint: 'Sign-in service is reachable.', timeoutHint: VPN_AV_HINT, blockedHint: BLOCK_HINT }),
    classify('Database (firestore.googleapis.com)', firestore, { reachableHint: 'Database is reachable.', timeoutHint: VPN_AV_HINT, blockedHint: BLOCK_HINT }),
    {
      name: 'General internet (non-Google)',
      ok: internet.state !== 'timeout', // no-cors returns opaque; treat non-timeout as up
      kind: internet.state === 'timeout' ? 'timeout' : undefined,
      label: internet.state === 'timeout' ? `No response (timed out after ${internet.ms} ms)` : `Reachable (${internet.ms} ms)`,
      hint: internet.state === 'timeout' ? 'Your internet connection itself looks down or fully blocked — check Wi‑Fi/router, then your VPN.' : '',
    },
    {
      name: 'Browser storage (session/IndexedDB)',
      ok: store.sessionStorage && store.indexedDB,
      kind: 'storage',
      label: store.sessionStorage && store.indexedDB ? 'Available' : `Restricted — ${store.detail || 'storage partially blocked'}`,
      hint: store.sessionStorage && store.indexedDB ? '' : 'Your browser is blocking site storage (cookies/site data). Allow cookies & site data for this site, or disable "block all cookies".',
    },
  ]

  const authFailed = !checks[0].ok
  const internetUp = checks[2].ok
  let verdict, advice
  if (!authFailed) {
    verdict = 'ok'
    advice = 'Connection to the sign-in service is working. If you still see a "Network error", it was a brief blip — just try signing in again.'
  } else if (internetUp) {
    verdict = checks[0].kind === 'timeout' ? 'intercepted' : 'blocked'
    advice = checks[0].kind === 'timeout' ? VPN_AV_HINT : BLOCK_HINT
  } else {
    verdict = 'offline'
    advice = 'Your internet connection looks down. Check your Wi‑Fi/network (and disconnect any VPN), then try again.'
  }

  return { checks, verdict, advice }
}
