import { updateDoc, doc } from 'firebase/firestore'
import {
  updateProfile as updateAuthProfile,
  updatePassword,
} from 'firebase/auth'
import { auth, db } from '../lib/firebase'
import { subscribeOrgUsers as sharedOrgUsers } from '../../../shared/org/orgData'

const createdMs = (u) => {
  const c = u?.createdAt
  if (!c) return 0
  if (typeof c.toMillis === 'function') return c.toMillis()
  const t = new Date(c).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * Subscribe to all users within an organization (admin view). Backed by the
 * shared ref-counted org-users listener; this module expects `id` instead of
 * `uid` and newest-first ordering, so adapt the shared rows.
 */
export function subscribeOrgUsers(orgId, callback) {
  return sharedOrgUsers(orgId, (users) => {
    const rows = users.map(({ uid, ...rest }) => ({ id: uid, ...rest }))
    rows.sort((a, b) => createdMs(b) - createdMs(a))
    callback(rows)
  })
}

export function approveUser(uid) {
  return updateDoc(doc(db, 'users', uid), { status: 'approved' })
}

export function rejectUser(uid) {
  return updateDoc(doc(db, 'users', uid), { status: 'rejected' })
}

export function setUserRole(uid, role) {
  return updateDoc(doc(db, 'users', uid), { role })
}

export function updateOwnName(uid, name) {
  const tasks = [updateDoc(doc(db, 'users', uid), { name })]
  if (auth.currentUser) {
    tasks.push(updateAuthProfile(auth.currentUser, { displayName: name }))
  }
  return Promise.all(tasks)
}

export function changeOwnPassword(newPassword) {
  return updatePassword(auth.currentUser, newPassword)
}
