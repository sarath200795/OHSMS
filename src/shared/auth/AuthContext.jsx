import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as fbSignOut,
  onAuthStateChanged,
  updateProfile,
  deleteUser,
  OAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
} from 'firebase/auth'
import { auth, isFirebaseConfigured } from '../firebase'
import { isMfaRequired, resolverFor, completeTotpSignIn } from './mfa'
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

  // The other end of the SSO redirect fallback. Coming back from the identity
  // provider looks like a fresh page load, so the result has to be collected
  // here — and it can raise the same second-factor challenge the popup path
  // does, which is why the resolver is held in state for the login screen to
  // pick up rather than being thrown away with the page.
  const [pendingMfa, setPendingMfa] = useState(null)

  useEffect(() => {
    if (!isFirebaseConfigured) return
    getRedirectResult(auth).catch((err) => {
      if (isMfaRequired(err)) {
        setPendingMfa(resolverFor(err))
        return
      }
      // No redirect in progress is the normal case and resolves to null; a real
      // failure here would otherwise vanish, leaving a login screen that simply
      // does nothing after the round trip.
      if (err?.code) {
        // eslint-disable-next-line no-console
        console.error('[auth] single sign-on redirect failed:', err.code)
      }
    })
  }, [])

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

  // Sign-in is not always one step. Every entry point funnels through here so
  // the second-factor branch cannot be forgotten at one of them.
  const adopt = async (cred) => {
    // Set user immediately so isAuthed is true right away — don't wait for the
    // async listener, which would let the redirect bounce off ProtectedRoute.
    setUser(cred.user)
    await withRetry(() => refreshProfile(cred.user.uid))
    return { status: 'signed-in', user: cred.user }
  }

  /**
   * @returns { status: 'signed-in' } or { status: 'mfa', resolver }
   *
   * A required second factor is NOT an error — it is an unfinished sign-in, and
   * returning it as a result rather than throwing is what stops a caller
   * reporting "wrong password" to someone whose password was right.
   */
  const login = async ({ email, password }) => {
    try {
      return await adopt(await withRetry(() => signInWithEmailAndPassword(auth, email, password)))
    } catch (err) {
      if (isMfaRequired(err)) return { status: 'mfa', resolver: resolverFor(err) }
      throw err
    }
  }

  /** Finish a challenged sign-in with the code from the authenticator app. */
  const completeMfa = async (resolver, code) => adopt(await completeTotpSignIn(resolver, code))

  /**
   * Federated sign-in. Popup first because it keeps the user on the page and
   * needs no redirect-result plumbing; falls back to a full redirect when the
   * browser blocks it, which is common on locked-down corporate devices — the
   * exact fleet most likely to have SSO in the first place.
   */
  const loginWithSso = async (providerId) => {
    const provider = new OAuthProvider(providerId)
    try {
      return await adopt(await signInWithPopup(auth, provider))
    } catch (err) {
      if (isMfaRequired(err)) return { status: 'mfa', resolver: resolverFor(err) }
      if (err?.code === 'auth/popup-blocked' || err?.code === 'auth/operation-not-supported-in-this-environment') {
        await signInWithRedirect(auth, provider)
        return { status: 'redirecting' }
      }
      // Closing the popup is a decision, not a failure worth shouting about.
      if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') {
        return { status: 'cancelled' }
      }
      throw err
    }
  }

  const resetPassword = async (email) => {
    await withRetry(() => sendPasswordResetEmail(auth, email))
  }

  const signOut = async () => {
    await fbSignOut(auth)
    setUser(null)
    setProfile(null)
    // A half-finished sign-in must not outlive the session it belonged to.
    setPendingMfa(null)
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
    loginWithSso,
    completeMfa,
    pendingMfa,
    clearPendingMfa: () => setPendingMfa(null),
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
