// One-time secret intake. The token is shown once. Only its hash is kept.
// The secrets go to the secret store the control plane holds. They are not
// written onto the provisioning request and they are not echoed back.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const ALLOWED = [
  'databaseUrl',
  'sessionSecret',
  'oidcClientSecret',
  'samlIdpCert',
  'samlEntryPoint',
  'supabaseAnonKey',
  'supabaseServiceRole',
  'dataKeyMaster',
  's3AccessKeyId',
  's3SecretAccessKey',
  'smtpPass',
]

export function newIntakeToken() {
  return randomBytes(32).toString('base64url')
}

export function hashIntakeToken(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}

function hashesEqual(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8')
  const y = Buffer.from(String(b || ''), 'utf8')
  if (x.length !== y.length) {
    timingSafeEqual(x, x)
    return false
  }
  return timingSafeEqual(x, y)
}

/**
 * Keep only the server-side slots. Anything else is dropped, including a
 * field someone hoped would land on the Firestore request.
 */
export function takeSecrets(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return { ok: false, reason: 'shape' }
  const value = {}
  for (const key of ALLOWED) {
    if (input[key] == null || input[key] === '') continue
    if (typeof input[key] !== 'string') return { ok: false, reason: 'shape' }
    value[key] = input[key]
  }
  if (!Object.keys(value).length) return { ok: false, reason: 'empty' }
  return { ok: true, value }
}

/**
 * The only fields a fulfillment run may write back onto the request.
 * A secret that appears here is a bug, and the caller drops the run.
 */
export function statusPatch(fields) {
  const out = {}
  if (fields.status === 'provisioned' || fields.status === 'live' || fields.status === 'failed') {
    out.status = fields.status
  }
  if (typeof fields.dedicatedUrl === 'string' && /^https?:\/\/[^\s@]+$/.test(fields.dedicatedUrl)) {
    out.dedicatedUrl = fields.dedicatedUrl
  }
  if (fields.secretsReceived === true) out.secretsReceived = true
  const banned = JSON.stringify(out).toLowerCase()
  if (
    /postgres(ql)?:\/\//.test(banned) ||
    banned.includes('data_key_master') ||
    banned.includes('service_role') ||
    banned.includes('password')
  ) {
    throw new Error('status patch refused: it carries a secret')
  }
  return out
}

export function checkIntake({ email, request, token, tokenHash }) {
  const want = String(request?.handoffContact || request?.contactEmail || '')
    .trim()
    .toLowerCase()
  if (
    !want ||
    String(email || '')
      .trim()
      .toLowerCase() !== want
  )
    return { ok: false, reason: 'email' }
  if (!token || !tokenHash || !hashesEqual(hashIntakeToken(token), tokenHash))
    return { ok: false, reason: 'token' }
  return { ok: true }
}
