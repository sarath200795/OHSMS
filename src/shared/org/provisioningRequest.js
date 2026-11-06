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
export async function fileProvisioningRequest(input) {
  const checked = validateProvisioningRequest(input)
  if (!checked.ok) {
    const err = new Error(checked.errors.form || 'Check the request and try again.')
    err.fields = checked.errors
    throw err
  }

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
