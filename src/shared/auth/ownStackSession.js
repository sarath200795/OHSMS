// The own-stack session the browser may hold.
//
// It proves who signed in (the uid). It does not prove role, approval, or
// mustChangePassword: those are read from the profile at the gateway, because
// a claim baked into the token would stay true for the life of the token
// after the person was suspended (storage.rules, S-19). The token is not a
// database password and it is not a VITE_ variable.

import { publicStackValue } from '../stackPublicEnv'

export function isOwnStackBuild() {
  return publicStackValue('VITE_DATA_DRIVER').toLowerCase() === 'postgres'
}

export function ownStackGateway() {
  return publicStackValue('VITE_DATA_GATEWAY').replace(/\/$/, '')
}

export function ownStackAuthMethod() {
  return publicStackValue('VITE_AUTH_METHOD').toLowerCase()
}

const KEY = 'ohsms.ownStack.session'
let memory = ''
// Set before the token is cleared. /login would otherwise start a new
// ForceAuthn while sign-out is still asking the IdP to drop its cookie, and
// the approval page's Sign out never finishes.
let signedOutHold = false

export function holdOwnStackSignIn() {
  signedOutHold = true
}

export function ownStackSignInHeld() {
  return signedOutHold
}

export function resetOwnStackSignInHold() {
  signedOutHold = false
}

export function shouldStartCompanySignIn({ idpStart, isAuthed, token, search, held }) {
  if (!idpStart || isAuthed || token || held) return false
  return new URLSearchParams(String(search || '')).get('signedOut') !== '1'
}

export function setAccessToken(token) {
  memory = typeof token === 'string' ? token : ''
  if (memory) signedOutHold = false
  try {
    if (memory) sessionStorage.setItem(KEY, memory)
    else sessionStorage.removeItem(KEY)
  } catch {
    // Private mode and the test runner have no storage. The memory copy is
    // the session for this tab either way.
  }
}

export function currentAccessToken() {
  if (memory) return memory
  try {
    memory = sessionStorage.getItem(KEY) || ''
  } catch {
    memory = ''
  }
  return memory
}

export function clearAccessToken() {
  setAccessToken('')
}

// The SAML response lands on /#session= before React Router runs. A later
// <Navigate> drops the hash, and /login then starts a new ForceAuthn request.
// Keycloak still has the session cookie, so it shows "Please re-authenticate
// to continue" again. Read the hash before that navigation.
export function captureOwnStackSessionFromHash(
  loc = globalThis.location,
  history = globalThis.history
) {
  if (!isOwnStackBuild()) return ''
  const hash = String(loc?.hash || '')
  if (!hash.includes('session=')) return ''
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('session') || ''
  if (!token) return ''
  setAccessToken(token)
  const next = `${loc.pathname || '/'}${loc.search || ''}`
  try {
    history?.replaceState?.({}, '', next)
  } catch {
    // The token is already stored. A history API that refuses the rewrite
    // must not drop the session.
  }
  return token
}

function decodeBase64Url(part) {
  const pad = part.replace(/-/g, '+').replace(/_/g, '/')
  const padded = pad + '='.repeat((4 - (pad.length % 4)) % 4)
  if (typeof atob === 'function') return atob(padded)
  return Buffer.from(padded, 'base64').toString('utf8')
}

/** uid from the token payload. Unverified: the gateway checks the signature. */
export function sessionUid(token = currentAccessToken()) {
  const part = String(token || '').split('.')[1]
  if (!part) return ''
  try {
    const json = JSON.parse(decodeBase64Url(part))
    return typeof json.sub === 'string' ? json.sub : ''
  } catch {
    return ''
  }
}
