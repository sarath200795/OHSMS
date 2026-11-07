import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from '../data/client.js'
import { db } from '../firebase'
import { ownStackGateway } from '../auth/ownStackSession'
import { publicStackValue } from '../stackPublicEnv'
import { findOrgByName, orgIndexRef } from './orgData'
import {
  NAME_OWN,
  NAME_WEEHS,
  NOT_FILED,
  REQUEST_ID,
  validateProvisioningRequest,
} from './provisioningSchema'

export {
  AUTH_METHODS,
  BUCKET_MODES,
  HOSTING_MODES,
  OWN_STACK_JOIN_MESSAGE,
  PROVISIONING_FIELDS,
  authMethodLabel,
  hostingModeLabel,
  nameTakenMessage,
  validateProvisioningRequest,
} from './provisioningSchema'

/**
 * File the request and reserve the organization name.
 *
 * One batch: the request, and an orgIndex row whose only public fields are
 * the name, `stack: 'own'`, and the request id. Signup reads that row and
 * must not create a WEEHS password account. The request document itself is
 * not publicly readable — it holds the contact email.
 *
 * @param {Record<string, unknown>} input
 * @returns {Promise<{ id: string, orgName: string, contactEmail: string, handoffContact: string, mode: string, engine: string, authMethod: string }>}
 */
export function localControlPlane() {
  return publicStackValue('VITE_CONTROL_PLANE') === 'local'
}

function requestId() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')
}

export function localRequestDefaults() {
  if (!localControlPlane()) return null
  return {
    mode: 'bring',
    engine: 'postgres',
    authMethod: 'saml',
    authIssuer: publicStackValue('VITE_AUTH_ISSUER'),
    authClientId: publicStackValue('VITE_AUTH_CLIENT_ID') || 'ohsms',
    bucketMode: 'bring',
    bucketName: 'ohsms',
    bucketRegion: 'us-east-1',
    presignUrl: publicStackValue('VITE_S3_PRESIGN_ENDPOINT'),
  }
}

const LOCAL_FILING_MESSAGES = {
  identity:
    'The identity provider refused the registration. No organization was saved. You can submit this form again.',
  fulfill:
    'The server did not finish the organization. Check registration status before submitting again.',
  'in-progress':
    'A registration for this name is already running. Wait, then check status before submitting again.',
  timeout: 'The server did not answer in time. Check registration status before submitting again.',
  network: 'The server could not be reached. Check registration status before submitting again.',
  url: 'The address was refused.',
  fields: 'A field was refused.',
  echo: 'The server refused to finish the registration. Check registration status before submitting again.',
  'public-env':
    'The server refused the registration before saving the organization. You can submit this form again.',
}

function safeToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9-]{1,32}$/.test(value) ? value : ''
}

function localFilingFailure(reason, body = {}) {
  const code = Object.prototype.hasOwnProperty.call(LOCAL_FILING_MESSAGES, reason)
    ? reason
    : 'refused'
  const detail = [safeToken(body.stage), safeToken(body.code)].filter(Boolean).join(' ')
  const text =
    LOCAL_FILING_MESSAGES[code] ||
    'The request was not filed. Check registration status before submitting again.'
  const err = new Error(detail ? `${text} (${detail})` : text)
  err.reason = code
  return err
}

async function fileOnControlPlane(value) {
  const gateway = ownStackGateway()
  if (!gateway) throw new Error('This stack has no control plane configured.')
  const id = requestId()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60000)
  try {
    let res
    try {
      res = await fetch(`${gateway}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...value, id }),
        signal: controller.signal,
      })
    } catch (err) {
      throw localFilingFailure(err?.name === 'AbortError' ? 'timeout' : 'network')
    }
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body.ok === false) throw localFilingFailure(body.reason, body)
    return {
      id: body.requestId || id,
      orgName: value.orgName,
      contactEmail: value.contactEmail,
      handoffContact: value.handoffContact,
      mode: value.mode,
      engine: value.engine,
      authMethod: value.authMethod,
      status: body.status || 'requested',
      dedicatedUrl: body.dedicatedUrl || '',
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function fileProvisioningRequest(input) {
  const checked = validateProvisioningRequest(input, { allowLoopback: localControlPlane() })
  if (!checked.ok) {
    const err = new Error(checked.errors.form || 'Check the request and try again.')
    err.fields = checked.errors
    throw err
  }

  // The dedicated host has no Firestore name index. The control plane
  // refuses a second live organization. The shared suite still checks
  // orgIndex before it writes.
  if (localControlPlane()) return fileOnControlPlane(checked.value)

  let existing = null
  try {
    existing = await findOrgByName(checked.value.orgName)
  } catch {
    throw new Error('The name could not be checked. The request was not filed.')
  }
  if (existing?.stack === 'own') throw new Error(NAME_OWN)
  if (existing) throw new Error(NAME_WEEHS)

  const ref = doc(collection(db, 'provisioningRequests'))
  if (!REQUEST_ID.test(ref.id)) {
    throw new Error('The request could not be filed.')
  }

  const batch = writeBatch(db)
  batch.set(ref, { ...checked.value, createdAt: serverTimestamp() })
  batch.set(orgIndexRef(checked.value.orgName), {
    name: checked.value.orgName,
    stack: 'own',
    requestId: ref.id,
  })
  try {
    await batch.commit()
  } catch {
    throw new Error(NOT_FILED)
  }

  return {
    id: ref.id,
    orgName: checked.value.orgName,
    contactEmail: checked.value.contactEmail,
    handoffContact: checked.value.handoffContact,
    mode: checked.value.mode,
    engine: checked.value.engine,
    authMethod: checked.value.authMethod,
  }
}

// The platform console reads this. A tenant admin cannot: the rules refuse
// list to everyone except a platform operator. Cap is the page's honesty
// bound — a full customer directory of requests is not what this screen is.
export const PROVISIONING_LIST_CAP = 100

const LIST_FIELDS = [
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
  'dedicatedUrl',
  'secretsReceived',
]

export async function listProvisioningRequests() {
  const snap = await getDocs(
    query(
      collection(db, 'provisioningRequests'),
      orderBy('createdAt', 'desc'),
      limit(PROVISIONING_LIST_CAP)
    )
  )
  return {
    capped: snap.size >= PROVISIONING_LIST_CAP,
    rows: snap.docs.map((d) => {
      const data = d.data()
      const row = { id: d.id }
      for (const key of LIST_FIELDS) row[key] = data[key]
      return row
    }),
  }
}
