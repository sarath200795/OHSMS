// ─────────────────────────────────────────────────────────────────────────────
// All Firestore access goes through here. Org-scoped paths:
//   organizations/{orgId}                          — org doc
//   organizations/{orgId}/assessments/{id}         — risk assessments
//   users/{uid}                                    — user profiles
//   orgIndex/{slug}                                — public name→org index (signup)
// ─────────────────────────────────────────────────────────────────────────────
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  limit,
} from 'firebase/firestore'
import { db } from '../firebase'
import { reserveDocId } from '../../../shared/docId/reserve'

// ── Path helpers ─────────────────────────────────────────────────────────────
const orgRef = (orgId) => doc(db, 'organizations', orgId)
const assessmentCol = (orgId) => collection(db, 'organizations', orgId, 'assessments')
const assessmentRef = (orgId, id) => doc(db, 'organizations', orgId, 'assessments', id)

// ── Organizations & users ─────────────────────────────────────────────────────

// Default snapshot error handler: log a warning instead of letting Firestore
// raise an "Uncaught Error in snapshot listener" that can hang/blank the UI.
const onSnapErr = (label) => (err) => {
  // eslint-disable-next-line no-console
  console.warn(`[HIRA] ${label} listener error:`, err?.code || err?.message || err)
}

// Delegated to the shared ref-counted org-users listener (one per org app-wide).
export { subscribeOrgUsers } from '../../../shared/org/orgData'

/** Live org document (name, address, sites, …). */
export function subscribeOrg(orgId, cb, onError) {
  return onSnapshot(orgRef(orgId), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null), onError || onSnapErr('org'))
}

/** Replace the org's list of sites/facilities. */
export async function updateOrgSites(orgId, sites) {
  await updateDoc(orgRef(orgId), { sites })
}

// ── Activity log (append-only audit trail) ────────────────────────────────────
const activityCol = (orgId) => collection(db, 'organizations', orgId, 'activity')

/** Record a user action. Fire-and-forget — never blocks the main operation. */
export function logActivity(orgId, actor, { type, message, assessmentId = null }) {
  if (!orgId) return
  addDoc(activityCol(orgId), {
    type: type || 'event',
    message: message || '',
    assessmentId,
    actorUid: actor?.uid || null,
    actorName: actor?.name || 'Someone',
    at: serverTimestamp(),
  }).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn('[HIRA] activity log failed:', e?.message || e)
  })
}

export function subscribeActivity(orgId, cb, onError, max = 50) {
  const q = query(activityCol(orgId), orderBy('at', 'desc'), limit(max))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError || onSnapErr('activity'))
}

// ── Risk assessments ──────────────────────────────────────────────────────────

const ASSESSMENT_LOAD_CAP = 1000

export function subscribeAssessments(orgId, cb, onError, max = ASSESSMENT_LOAD_CAP) {
  const q = query(assessmentCol(orgId), orderBy('createdAt', 'desc'), limit(max))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError || onSnapErr('assessments'))
}

/** Strip undefined values so Firestore accepts the nested write. */
function clean(value) {
  if (Array.isArray(value)) return value.map(clean)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = clean(v)
    }
    return out
  }
  return value
}

export async function createAssessment(orgId, data, actor) {
  const ref = await addDoc(assessmentCol(orgId), {
    ...clean(data),
    docId: await reserveDocId(orgId, 'hira'),
    createdBy: actor?.uid || null,
    createdByName: actor?.name || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateAssessment(orgId, id, data) {
  await updateDoc(assessmentRef(orgId, id), {
    ...clean(data),
    updatedAt: serverTimestamp(),
  })
}

export async function deleteAssessment(orgId, id) {
  await deleteDoc(assessmentRef(orgId, id))
}

/** Bulk create assessments (from CSV import) in chunked batches. `kind` marks
 *  the imported rows as 'site' (normal) or 'baseline' (activity template). */
export async function bulkCreateAssessments(orgId, list, actor, kind = 'site') {
  let created = 0
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200)
    const batch = writeBatch(db)
    for (const data of chunk) {
      const ref = doc(assessmentCol(orgId))
      batch.set(ref, {
        ...clean(data),
        kind,
        baselineId: '',
        createdBy: actor?.uid || null,
        createdByName: actor?.name || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      created++
    }
    await batch.commit()
  }
  return created
}
