import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as fbSignOut,
  onAuthStateChanged,
  updateProfile,
  deleteUser,
} from 'firebase/auth'
import { auth, isFirebaseConfigured } from '../firebase'
import {
  createOrganization,
  createPendingMember,
  findOrgByName,
  getUserProfile,
  subscribeOrg,
} from '../org/orgData'

const AuthContext = createContext(null)

// Transient network blips surface as auth/network-request-failed (Auth) or
// unavailable / deadline-exceeded (Firestore). Retry with backoff so a single
// dropped request doesn't fail sign-in. Deterministic errors throw immediately.
const TRANSIENT = new Set([
  'auth/network-request-failed',
  'auth/timeout',
  'unavailable',
  'deadline-exceeded',
])
async function withRetry(fn, tries = 3) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (!TRANSIENT.has(err?.code) || i === tries - 1) throw err
      await new Promise((r) => setTimeout(r, 700 * (i + 1)))
    }
  }
  throw lastErr
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null) // firebase auth user
  const [profile, setProfile] = useState(null) // users/{uid} doc
  const [org, setOrg] = useState(null) // organizations/{orgId} doc (live)
  const [loading, setLoading] = useState(true)

  const refreshProfile = useCallback(async (uid) => {
    const p = await getUserProfile(uid)
    setProfile(p)
    return p
  }, [])

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false)
      return
    }
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u)
      if (u) await refreshProfile(u.uid)
      else setProfile(null)
      setLoading(false)
    })
    return unsub
  }, [refreshProfile])

  // Keep the org document live so any screen can read org-level config (e.g. the
  // per-module scope granularity settings) without its own subscription.
  useEffect(() => {
    const orgId = profile?.orgId
    if (!orgId) {
      setOrg(null)
      return
    }
    return subscribeOrg(orgId, setOrg)
  }, [profile?.orgId])

  // Register a brand new organization; caller becomes admin. Create the auth
  // user FIRST so the org-name lookup runs authenticated (rules require sign-in).
  const registerOrganization = async ({ orgName, address, name, email, password }) => {
    const cred = await withRetry(() => createUserWithEmailAndPassword(auth, email, password))
    try {
      const existing = await findOrgByName(orgName)
      if (existing) {
        throw new Error('An organization with that name already exists. Try signing up to join it.')
      }
      await updateProfile(cred.user, { displayName: name })
      await createOrganization({ orgName, address, uid: cred.user.uid, name, email })
      setUser(cred.user)
      await withRetry(() => refreshProfile(cred.user.uid))
    } catch (err) {
      await deleteUser(cred.user).catch(() => {})
      throw err
    }
  }

  // Sign up to join an existing org (pending admin approval).
  const signUpMember = async ({ orgId, orgName, name, email, password, department }) => {
    if (!orgId) throw new Error('Please select your organization.')
    const cred = await withRetry(() => createUserWithEmailAndPassword(auth, email, password))
    try {
      await updateProfile(cred.user, { displayName: name })
      await createPendingMember({ uid: cred.user.uid, name, email, orgId, orgName: orgName || '', department })
      setUser(cred.user)
      await withRetry(() => refreshProfile(cred.user.uid))
    } catch (err) {
      await deleteUser(cred.user).catch(() => {})
      throw err
    }
  }

  const login = async ({ email, password }) => {
    const cred = await withRetry(() => signInWithEmailAndPassword(auth, email, password))
    // Set user immediately so isAuthed is true right away — don't wait for the
    // async listener, which would let the redirect bounce off ProtectedRoute.
    setUser(cred.user)
    await withRetry(() => refreshProfile(cred.user.uid))
  }

  const resetPassword = async (email) => {
    await withRetry(() => sendPasswordResetEmail(auth, email))
  }

  const signOut = async () => {
    await fbSignOut(auth)
    setUser(null)
    setProfile(null)
  }

  const role = profile?.role || null
  const value = {
    user,
    profile,
    org,
    loading,
    isAuthed: Boolean(user),
    isApproved: profile?.status === 'approved',
    role,
    isAdmin: role === 'admin',
    isManager: role === 'admin' || role === 'manager',
    isReadOnly: role === 'auditor',
    orgId: profile?.orgId || null,
    orgName: profile?.orgName || '',
    actor: { uid: user?.uid, name: profile?.name || user?.displayName || 'Unknown' },
    registerOrganization,
    signUpMember,
    login,
    resetPassword,
    signOut,
    refreshProfile: () => user && refreshProfile(user.uid),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
