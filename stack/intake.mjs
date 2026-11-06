// One-time secret intake. The token is shown once — in the handoff email, or in
// the start response only when that mail was not sent. Only its hash is kept.
// The secrets go to the secret store the control plane holds. They are not
// written onto the provisioning request and they are not echoed back.
//
// A second copy of the token in the start response, after the mail already
// carried it, is how an access log becomes another copy of a one-time
// credential. The caller drops the token from the response when the mail
// was accepted.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const INTAKE_FIELDS = [
  {
    key: 'databaseUrl',
    label: 'Database URL',
    hint: 'Connection string for this company. It stays on this host.',
  },
  {
    key: 'sessionSecret',
    label: 'Session signing secret',
    hint: 'Signs the session cookie on this environment.',
  },
  {
    key: 'oidcClientSecret',
    label: 'OIDC client secret',
    hint: 'The identity provider client secret. Not the public client id.',
  },
  {
    key: 'samlIdpCert',
    label: 'SAML IdP certificate',
    hint: 'The identity provider certificate, not a private key for this app.',
  },
  {
    key: 'samlEntryPoint',
    label: 'SAML entry point',
    hint: 'The identity provider sign-in URL.',
  },
  {
    key: 'supabaseAnonKey',
    label: 'Supabase anon key',
    hint: 'Public by construction. The service-role key is the next field.',
  },
  {
    key: 'supabaseServiceRole',
    label: 'Supabase service-role key',
    hint: 'Bypasses row level security. Never a field on the registration form.',
  },
  {
    key: 'dataKeyMaster',
    label: 'DATA_KEY_MASTER',
    hint: 'This company holds it. It is not stored on the provisioning request.',
  },
  {
    key: 's3AccessKeyId',
    label: 'S3 access key id',
    hint: 'Used by the presign host only.',
  },
  {
    key: 's3SecretAccessKey',
    label: 'S3 secret access key',
    hint: 'Used by the presign host only.',
  },
  {
    key: 'smtpPass',
    label: 'SMTP password',
    hint: 'The mail password for this environment.',
  },
]

export const ALLOWED = INTAKE_FIELDS.map((field) => field.key)

const PUBLIC_KEYS = [
  'id',
  'orgName',
  'address',
  'contactName',
  'contactEmail',
  'handoffContact',
  'mode',
  'engine',
  'authMethod',
  'authIssuer',
  'authClientId',
  'bucketMode',
  'bucketName',
  'bucketRegion',
  'presignUrl',
]

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

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

function looksSecret(value) {
  return (
    /postgres(ql)?:\/\//i.test(value) ||
    /service[-_]?role/i.test(value) ||
    value.includes('DATA_KEY_MASTER') ||
    /BEGIN [A-Z ]*PRIVATE KEY/.test(value) ||
    /password\s*=/i.test(value)
  )
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
 * A provisioning request the control plane may store. Secret keys are refused,
 * not stripped: dropping one would let the caller believe it had been saved.
 * Status is always `requested`. A client that can file `live` is how a request
 * starts looking served before the handoff.
 */
export function takePublicRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return { ok: false, reason: 'shape' }
  for (const key of Object.keys(input)) {
    if (key === 'status') continue
    if (ALLOWED.includes(key)) return { ok: false, reason: 'secret' }
    if (!PUBLIC_KEYS.includes(key)) return { ok: false, reason: 'field' }
    if (typeof input[key] !== 'string') return { ok: false, reason: 'shape' }
    if (looksSecret(input[key])) return { ok: false, reason: 'secret' }
  }
  if (typeof input.status === 'string' && input.status !== 'requested') {
    return { ok: false, reason: 'status' }
  }
  const id = String(input.id || '')
  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return { ok: false, reason: 'id' }
  const contact = String(input.handoffContact || input.contactEmail || '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return { ok: false, reason: 'email' }
  const value = { id, status: 'requested' }
  for (const key of PUBLIC_KEYS) {
    if (key === 'id') continue
    if (typeof input[key] === 'string') value[key] = input[key]
  }
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

export function checkIntake({ email, request, token, tokenHash, used }) {
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
  if (used) return { ok: false, reason: 'reused' }
  if (!token || !tokenHash || !hashesEqual(hashIntakeToken(token), tokenHash))
    return { ok: false, reason: 'token' }
  return { ok: true }
}

/**
 * HTTPS, except a loopback origin used by the local demo. A token in a link
 * mailed at a public http origin would cross the network in the clear.
 */
export function handoffLink({ origin, requestId, token }) {
  let base
  try {
    base = new URL(origin)
  } catch {
    return { ok: false, reason: 'origin' }
  }
  const local = LOCAL_HOSTS.has(base.hostname)
  if (base.protocol !== 'https:' && !(local && base.protocol === 'http:')) {
    return { ok: false, reason: 'https' }
  }
  if (!requestId || !token) return { ok: false, reason: 'token' }
  const url = new URL('/handoff', base)
  url.searchParams.set('request', requestId)
  url.searchParams.set('token', token)
  return { ok: true, url: url.toString() }
}

export function handoffMessage({ to, orgName, requestId, url }) {
  const safeTo = String(to || '')
    .trim()
    .replace(/[\r\n]/g, '')
  const safeOrg = String(orgName || 'your organization')
    .replace(/[\r\n]/g, ' ')
    .slice(0, 120)
  const safeId = String(requestId || '').replace(/[\r\n]/g, '')
  return {
    to: safeTo,
    subject: `Secret handoff for ${safeOrg}`,
    text: [
      `Submit secrets for ${safeOrg} on this one-time page:`,
      '',
      String(url),
      '',
      `Request ${safeId}. The link works once. It is not a sign-in, and this message does not contain a database password or DATA_KEY_MASTER.`,
    ].join('\n'),
  }
}

/**
 * What an intake or fulfill response may say. Secret values that were just
 * submitted are refused here even if a caller tried to pass them through.
 */
export function publicOutcome(result, secrets) {
  const body = { ok: false }
  if (typeof result?.reason === 'string' && /^[a-z-]+$/.test(result.reason))
    body.reason = result.reason
  if (result?.ok) {
    body.ok = true
    body.status = 'live'
    if (typeof result.orgId === 'string') body.orgId = result.orgId
    if (typeof result.dedicatedUrl === 'string') body.dedicatedUrl = result.dedicatedUrl
  }
  const blob = JSON.stringify(body)
  for (const value of Object.values(secrets || {})) {
    if (typeof value === 'string' && value.length >= 4 && blob.includes(value)) {
      return { ok: false, reason: 'echo' }
    }
  }
  return body
}
