// ─────────────────────────────────────────────────────────────────────────────
// All Firestore access goes through here: org/user management (the auth +
// admin-approval workflow) plus the org-scoped consultation meetings and sites.
// ─────────────────────────────────────────────────────────────────────────────
import {
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import { reserveDocId } from '../../../shared/docId/reserve'

// ── Path helpers ─────────────────────────────────────────────────────────────
const consultationCol = (orgId) => collection(db, 'organizations', orgId, 'consultations')
const consultationRef = (orgId, id) => doc(db, 'organizations', orgId, 'consultations', id)
// Public, minimal name→org index so signup can look up an org by name WITHOUT
// reading the (member-only) organizations collection.
const orgIndexKey = (name) => (name || '').trim().toLowerCase()
const orgIndexRef = (name) => doc(db, 'orgIndex', orgIndexKey(name))

// ── Organizations & users ─────────────────────────────────────────────────────

/**
 * Backfill the public orgIndex entry for an org if it's missing. Idempotent +
 * non-blocking (the index is a convenience for signup, never critical).
 */
export async function ensureOrgIndex(org) {
  if (!org?.id || !org?.name) return
  try {
    const ref = orgIndexRef(org.name)
    const snap = await getDoc(ref)
    if (snap.exists()) return
    await setDoc(ref, { orgId: org.id, name: org.name })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[HSE] orgIndex backfill skipped:', e?.message || e)
  }
}

// Delegated to the shared ref-counted org-users listener (one per org app-wide).
export { subscribeOrgUsers } from '../../../shared/org/orgData'

// ── Sites (organizations/{orgId}/sites) ────────────────────────────────────────
// Facility sites the committee meetings are scoped/filtered by. { code, name }.

// Delegated to the shared ref-counted org-sites listener (one per org app-wide).
export { subscribeSites } from '../../../shared/org/orgData'

// ── Consultations / meetings (organizations/{orgId}/consultations) ──────────────

export function subscribeConsultations(orgId, cb, onError) {
  return onSnapshot(consultationCol(orgId),
    (snap) => cb(snap.docs.map((d) => ({ firebaseKey: d.id, ...d.data() }))),
    (err) => { console.warn('[HSE] consultations read failed:', err?.message || err); onError?.(err) },
  )
}

export async function addConsultation(orgId, data) {
  const ref = await addDoc(consultationCol(orgId), { ...data, docId: await reserveDocId(orgId, 'committee'), createdAt: serverTimestamp() })
  return ref.id
}

export async function updateConsultation(orgId, id, data) {
  await setDoc(consultationRef(orgId, id), data, { merge: true })
}

export async function deleteConsultation(orgId, id) {
  await deleteDoc(consultationRef(orgId, id))
}
