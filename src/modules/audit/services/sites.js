import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../lib/firebase'

const col = (orgId) => collection(db, 'organizations', orgId, 'sites')

// Delegated to the shared ref-counted org-sites listener (one per org app-wide).
export { subscribeSites } from '../../../shared/org/orgData'

export function createSite(orgId, data) {
  return addDoc(col(orgId), { ...data, createdAt: serverTimestamp() })
}

export function updateSite(orgId, siteId, data) {
  return updateDoc(doc(db, 'organizations', orgId, 'sites', siteId), data)
}

export function deleteSite(orgId, siteId) {
  return deleteDoc(doc(db, 'organizations', orgId, 'sites', siteId))
}
