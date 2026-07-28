import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
} from 'firebase/auth'
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { auth, db } from '../lib/firebase'

/**
 * Public, unauthenticated read of organizations so a new teammate can pick one
 * to request access to (used by the signup page).
 */
export function subscribeOrganizations(callback) {
  const q = query(collection(db, 'organizations'), orderBy('name'))
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  })
}

export async function listOrganizations() {
  const q = query(collection(db, 'organizations'), orderBy('name'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/**
 * Create a brand-new organization. The creating account becomes the approved
 * admin of that org.
 */
export async function createOrganization({
  orgName,
  location,
  name,
  email,
  password,
}) {
  const cred = await createUserWithEmailAndPassword(auth, email, password)
  const uid = cred.user.uid
  await updateProfile(cred.user, { displayName: name })

  const orgRef = doc(collection(db, 'organizations'))
  await setDoc(orgRef, {
    name: orgName,
    location: location || '',
    adminUid: uid,
    createdAt: serverTimestamp(),
  })

  await setDoc(doc(db, 'users', uid), {
    name,
    email,
    orgId: orgRef.id,
    role: 'admin',
    status: 'approved',
    createdAt: serverTimestamp(),
  })

  return { orgId: orgRef.id, uid }
}

/**
 * Request access to an existing organization. Creates an auth account plus a
 * pending user profile that an admin must approve.
 */
export async function requestAccess({ orgId, name, email, password }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password)
  const uid = cred.user.uid
  await updateProfile(cred.user, { displayName: name })

  await setDoc(doc(db, 'users', uid), {
    name,
    email,
    orgId,
    role: 'member',
    status: 'pending',
    createdAt: serverTimestamp(),
  })

  return { uid }
}

export function login({ email, password }) {
  return signInWithEmailAndPassword(auth, email, password)
}

export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email)
}

export function updateOrganization(orgId, data) {
  return updateDoc(doc(db, 'organizations', orgId), data)
}
