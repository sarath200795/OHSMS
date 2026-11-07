// Own-database registration files a provisioning request. It does not create a
// WEEHS user or a WEEHS organization.
//
// The failure this shape exists to prevent: two buttons on RegisterOrg that
// both call registerOrganization. The label would say "your database" and the
// company would be a tenant of the shared suite. docs/CUSTOM-STACK.md.
//
// What a client may store is the allowlist below, and firestore.rules repeats
// it. Contact name and email are in the clear on purpose: there is no
// organization yet, so there is no org data key to seal them under, and the
// rules have to read the strings to reject anything else. They are not module
// records. Database passwords, service-role keys, and DATA_KEY_MASTER are not
// fields. The company holds DATA_KEY_MASTER. This module has no argument for it.
//
// The same list firestore.rules admits on /provisioningRequests. A test reads
// the rules file and compares. Adding a field in only one place is how a
// secret field would get a client write.
export const PROVISIONING_FIELDS = [
  'status',
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
  'createdAt',
]

export const HOSTING_MODES = [
  {
    id: 'bring',
    label: 'We bring our own database',
    detail:
      'Any engine. postgres is the generic path. supabase is one Postgres flavor, not the only choice. Credentials stay off this form.',
  },
  {
    id: 'company-cloud',
    label: 'WEEHS provisions Postgres in our cloud account',
    detail: 'The engine is Postgres. The database password stays in your cloud account.',
  },
  {
    id: 'weehs-operated',
    label: 'WEEHS operates a dedicated project for us',
    detail:
      'Postgres, for this company alone. Your company holds DATA_KEY_MASTER. It is not stored in the shared suite.',
  },
]

export const AUTH_METHODS = [
  {
    id: 'oidc',
    label: 'Company OIDC',
    detail: 'The issuer URL and client id are public. The client secret is not a field here.',
  },
  {
    id: 'saml',
    label: 'Company SAML',
    detail: 'The issuer URL and client id are public. The client secret is not a field here.',
  },
  {
    id: 'supabase',
    label: 'Supabase Auth',
    detail:
      'An identity provider. It does not select the database. The service-role key is not a field here.',
  },
]

export const BUCKET_MODES = [
  { id: 'provision', label: 'WEEHS provisions a bucket' },
  { id: 'bring', label: 'We bring our own bucket' },
]

export const OWN_STACK_JOIN_MESSAGE =
  "This organization uses its own database and its own sign-in. There is no WEEHS account to create or join on this site. Sign-in starts on the company's dedicated URL after that environment is provisioned."

const WEEHS_NAME_TAKEN = 'An organization with that name already exists. Try signing up to join it.'

const SECRET_REFUSAL =
  'Database passwords, service-role keys, and DATA_KEY_MASTER are not collected here. Your company keeps those. They are submitted on the one-time handoff page, not on this form.'

export const NAME_OWN =
  'That organization name is already reserved for an own-database request. It is not a WEEHS organization, and there is no account to create or join here.'

export const NAME_WEEHS =
  'An organization with that name already uses the WEEHS database. This request was not filed.'

export const NOT_FILED =
  'The request was not filed. The name may already be taken, or a field was rejected. Nothing was created on the WEEHS database.'

// Keys a caller might add from the console. Normalised by stripping
// separators, so DATA_KEY_MASTER, dataKeyMaster and data-key-master are one key.
const FORBIDDEN_KEYS = new Set([
  'password',
  'databaseurl',
  'databasepassword',
  'dbpassword',
  'connectionstring',
  'servicerolekey',
  'servicerole',
  'clientsecret',
  's3secret',
  'secretaccesskey',
  'accesskey',
  'accesskeyid',
  'datakeymaster',
  'masterkey',
  'privatekey',
  'apikey',
  'authtoken',
  'idtoken',
  'refreshtoken',
  'servicekey',
])

const SECRET_VALUE = /postgres(?:ql)?:\/\//i
const SERVICE_ROLE = /service[-_]?role/i
const PRIVATE_KEY = /BEGIN [A-Z ]*PRIVATE KEY/
const PASSWORD_ASSIGN = /password\s*=/i

const ENGINE = /^[a-z][a-z0-9_-]{0,31}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const HTTPS = /^https:\/\/[^\s@?#]+$/
const CLIENT_ID = /^[A-Za-z0-9._~-]{1,200}$/
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/
const REGION = /^[a-z0-9-]{1,40}$/
export const REQUEST_ID = /^[A-Za-z0-9]{10,40}$/

const PROVISIONED_MODES = new Set(['company-cloud', 'weehs-operated'])

export function hostingModeLabel(id) {
  return HOSTING_MODES.find((m) => m.id === id)?.label || id || ''
}

export function authMethodLabel(id) {
  return AUTH_METHODS.find((m) => m.id === id)?.label || id || ''
}

export function nameTakenMessage(existing) {
  if (!existing) return ''
  if (existing.stack === 'own') return OWN_STACK_JOIN_MESSAGE
  return WEEHS_NAME_TAKEN
}

function normalizedKey(key) {
  return String(key)
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

function carriesSecret(value) {
  if (typeof value !== 'string') return false
  return (
    SECRET_VALUE.test(value) ||
    SERVICE_ROLE.test(value) ||
    value.includes('DATA_KEY_MASTER') ||
    PRIVATE_KEY.test(value) ||
    PASSWORD_ASSIGN.test(value)
  )
}

function fail(errors) {
  return { ok: false, errors }
}

/**
 * Check a provisioning request before any write.
 *
 * Returns `{ ok: true, value }` with only the allowlisted fields, or
 * `{ ok: false, errors }`. `createdAt` is not part of `value`: the writer
 * sets the server time, and a caller-supplied clock would let a request
 * look older than it is. Status is always `requested`.
 *
 * @param {Record<string, unknown>} input
 */
// http is accepted only for this machine, and only when the caller is the
// local self-host (allowLoopback). The URL parser is what rejects a password,
// a query, or a host that merely begins with 127.0.0.1. A prefix check would
// allow http://127.0.0.1.evil.example and http://user:pass@127.0.0.1, and the
// server would then fetch that issuer.
function loopbackHttp(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'http:') return false
  if (url.username || url.password) return false
  if (url.search || url.hash) return false
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return false
  // Node rewrites 2130706433 and 0x7f000001 into 127.0.0.1. Those are not the
  // address this host publishes, so the written host has to be one of the
  // two names as well.
  return /^http:\/\/(127\.0\.0\.1|localhost)(?::\d{1,5})?(?:\/|$)/i.test(value)
}

function acceptableUrl(value, allowLoopback) {
  if (HTTPS.test(value)) return true
  return Boolean(allowLoopback) && loopbackHttp(value)
}

export function validateProvisioningRequest(input, { allowLoopback = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return fail({ form: 'The request could not be read.' })
  }

  for (const key of Object.keys(input)) {
    if (FORBIDDEN_KEYS.has(normalizedKey(key)) || carriesSecret(String(key))) {
      return fail({ form: SECRET_REFUSAL })
    }
  }
  for (const value of Object.values(input)) {
    if (carriesSecret(value)) return fail({ form: SECRET_REFUSAL })
  }

  const allowed = new Set(PROVISIONING_FIELDS)
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      return fail({ form: 'That request includes a field this form does not accept.' })
    }
  }
  if ('createdAt' in input) {
    return fail({ createdAt: 'The filing time is set when the request is stored.' })
  }
  if ('status' in input && input.status !== 'requested') {
    return fail({
      status: 'A request is filed as requested. This form cannot mark it provisioned.',
    })
  }

  const errors = {}
  const orgName = String(input.orgName ?? '')
  const address = String(input.address ?? '')
  const contactName = String(input.contactName ?? '')
  const contactEmail = String(input.contactEmail ?? '').trim()
  const handoffContact = String(input.handoffContact ?? '').trim()
  const mode = String(input.mode ?? '')
  let engine = String(input.engine ?? '')
    .trim()
    .toLowerCase()
  const authMethod = String(input.authMethod ?? '')
  let authIssuer = String(input.authIssuer ?? '').trim()
  let authClientId = String(input.authClientId ?? '').trim()
  const bucketMode = String(input.bucketMode ?? '')
  let bucketName = String(input.bucketName ?? '')
    .trim()
    .toLowerCase()
  let bucketRegion = String(input.bucketRegion ?? '')
    .trim()
    .toLowerCase()
  let presignUrl = String(input.presignUrl ?? '').trim()

  if (!orgName.trim()) errors.orgName = 'Enter the organization name.'
  else if (orgName !== orgName.trim()) errors.orgName = 'The name cannot start or end with a space.'
  else if (orgName.length > 120) errors.orgName = 'Use a shorter organization name.'
  else if (orgName.includes('/')) errors.orgName = 'The name cannot contain a slash.'
  else {
    const key = orgName.trim().toLowerCase()
    if (key === '.' || key === '..') errors.orgName = 'Enter the organization name.'
  }

  if (address !== address.trim()) errors.address = 'The address cannot start or end with a space.'
  else if (address.length > 300) errors.address = 'Use a shorter address.'

  if (!contactName.trim()) errors.contactName = 'Enter your name.'
  else if (contactName !== contactName.trim())
    errors.contactName = 'The name cannot start or end with a space.'
  else if (contactName.length > 120) errors.contactName = 'Use a shorter name.'

  if (!EMAIL.test(contactEmail) || contactEmail.length > 200) {
    errors.contactEmail = 'Enter a work email.'
  }
  if (!EMAIL.test(handoffContact) || handoffContact.length > 200) {
    errors.handoffContact = 'Enter an email for the secret handoff.'
  }

  if (!HOSTING_MODES.some((m) => m.id === mode)) {
    errors.mode = 'Choose how the database will be hosted.'
  }
  if (PROVISIONED_MODES.has(mode)) engine = 'postgres'
  if (!ENGINE.test(engine)) {
    errors.engine =
      mode === 'bring'
        ? 'Name the engine in a short token, such as postgres or mysql. Not a connection string.'
        : 'WEEHS-provisioned databases are Postgres.'
  }

  if (!AUTH_METHODS.some((m) => m.id === authMethod)) {
    errors.authMethod = 'Choose company OIDC, company SAML, or Supabase Auth.'
  } else if (authMethod === 'supabase') {
    authClientId = ''
    if (authIssuer && !acceptableUrl(authIssuer, allowLoopback)) {
      errors.authIssuer = 'The project URL has to be an https address, with no password in it.'
    }
  } else {
    if (!acceptableUrl(authIssuer, allowLoopback)) {
      errors.authIssuer = 'The issuer URL has to be an https address, with no password in it.'
    }
    if (!CLIENT_ID.test(authClientId)) {
      errors.authClientId = 'Enter the public client id. Not the client secret.'
    }
  }
  if (authIssuer.length > 300) errors.authIssuer = 'Use a shorter issuer URL.'

  if (!BUCKET_MODES.some((m) => m.id === bucketMode)) {
    errors.bucketMode = 'Choose who provides the file bucket.'
  } else if (bucketMode === 'provision') {
    bucketName = ''
    bucketRegion = ''
    presignUrl = ''
  } else {
    if (!BUCKET.test(bucketName)) errors.bucketName = 'Enter the bucket name. Not an access key.'
    if (!REGION.test(bucketRegion))
      errors.bucketRegion = 'Enter the bucket region, such as ap-south-1.'
    if (presignUrl && !acceptableUrl(presignUrl, allowLoopback)) {
      errors.presignUrl = 'The presign endpoint has to be an https address, with no key in the URL.'
    }
    if (presignUrl.length > 500) errors.presignUrl = 'Use a shorter presign endpoint URL.'
  }

  if (Object.keys(errors).length) return fail(errors)

  return {
    ok: true,
    value: {
      status: 'requested',
      orgName: orgName.trim(),
      address: address.trim(),
      contactName: contactName.trim(),
      contactEmail,
      handoffContact,
      mode,
      engine,
      authMethod,
      authIssuer,
      authClientId,
      bucketMode,
      bucketName,
      bucketRegion,
      presignUrl,
    },
  }
}
