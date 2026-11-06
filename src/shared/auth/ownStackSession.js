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

export function setAccessToken(token) {
  memory = typeof token === 'string' ? token : ''
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
