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
import { clearKeyring } from '../crypto'
import { clearSharedSubscriptions } from '../org/sharedSubscription'
import { isMfaRequired, resolverFor, completeTotpSignIn } from './mfa'
import { subscribePlatformAdmin } from './platformAdmin'
import { startSession, endSession } from './sessionConstants'
import { normalizeEntitlement, subscribeEntitlement, isModuleEnabled } from '../modules/entitlements'
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
  // Which modules this organization may see. Defaults to the full product, so
  // every screen behaves exactly as it did before entitlements existed until
  // the document says otherwise — including during the moment before it loads.
  const [moduleMap, setModuleMap] = useState(() => normalizeEntitlement(null))
  const [modulesReady, setModulesReady] = useState(false)
  // null while the grant is still being read. The difference matters: the guard
  // on the console shows a not-found page to everyone who is not an operator,
  // and doing that before the answer is known would show it to the operator.
  const [platformAdmin, setPlatformAdmin] = useState(null)

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
      else {
        setProfile(null)
        // Every identity change drops the encryption keys, not just an explicit
        // sign-out: a token revoked by the claims trigger, an expired session,
        // a switch of account on a shared site laptop all arrive here and
        // nowhere else. Without this, a manager's medical private key — and the
        // content keys derived from it — would still be in memory when a member
        // signed in next, and their session would open records their own role
        // is refused. The keys are non-extractable, so dropping the reference
        // is the only way they go.
        clearKeyring()
        // And the cached org rows, for the same reason and in the same breath.
        // The shared listeners linger for 30 seconds after their last
        // subscriber leaves and serve their cache synchronously to the next
        // one — which on a shared laptop can be somebody else.
        clearSharedSubscriptions()
      }
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
    getRedirectResult(auth).then((cred) => {
      // A result here means a sign-in just completed on the other side of the
      // redirect. It never reaches adopt() — the session arrives with the page
      // load — so this is the only place that can start its clock.
      if (cred) startSession()
    }).catch((err) => {
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

  // Which modules this tenant has been given. Only an APPROVED member may read
  // the document — the rule is isApprovedMemberOf — so a pending joiner must
  // not subscribe, or the listener errors on every render of the waiting room.
  // They see no modules either way; /pending is the whole of their app.
  useEffect(() => {
    const orgId = profile?.orgId
    if (!orgId || profile?.status !== 'approved') {
      setModuleMap(normalizeEntitlement(null))
      setModulesReady(true)
      return undefined
    }
    setModulesReady(false)
    return subscribeEntitlement(orgId, (map) => {
      setModuleMap(map)
      setModulesReady(true)
    })
  }, [profile?.orgId, profile?.status])

  // Whether this account operates the platform. Watched rather than fetched
  // once, so a grant added or removed in the Firebase console takes effect in
  // an open tab without a sign-out.
  useEffect(() => {
    if (!user?.uid) {
      setPlatformAdmin(false) // resolved, and resolved to no.
      return undefined
    }
    setPlatformAdmin(null)
    return subscribePlatformAdmin(user.uid, setPlatformAdmin)
  }, [user?.uid])

  /**
   * Wait for the orgId custom claim to reach the session token.
   *
   * syncUserClaims is a FIRESTORE TRIGGER on users/{uid}: it cannot run until
   * the profile has been written, and it stamps the claim on the auth record,
   * not on the token already in this tab. So a single refresh straight after
   * the write is a race — usually lost — and the cost of losing it is an hour
   * of Cloud Storage refusing every upload, because storage.rules identifies
   * the tenant from that claim and nothing else.
   *
   * Polling rather than waiting a fixed time: the first attempt usually wins,
   * and the loop exists for the times it does not. Best-effort throughout — a
   * registration must not fail because a claim was slow.
   */
  const awaitOrgClaim = async (fbUser, tries = 4) => {
    for (let i = 0; i < tries; i++) {
      try {
        const { claims } = await fbUser.getIdTokenResult(true)
        if (claims?.orgId) return true
      } catch {
        // Offline, or the token endpoint is briefly unhappy. Try again.
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => { setTimeout(r, 300 * (i + 1)) })
    }
    return false
  }

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
      startSession()
      // The one place this MUST happen on the register path. This caller is an
      // approved admin from the moment the org exists, so syncUserClaims will
      // stamp them — but the token minted by createUserWithEmailAndPassword
      // above predates it, and login() is the only other place that refreshes.
      // Without this a brand-new admin cannot upload a single file until their
      // token happens to expire.
      //
      // signUpMember below deliberately does NOT do this: a joiner is pending,
      // syncUserClaims mints nothing for them (see storage.rules), and there
      // would be no claim to wait for. They get one at their first sign-in
      // after approval, which login() already forces.
      await awaitOrgClaim(cred.user)
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
      startSession()
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
    // The inactivity clock belongs to this session from here, not to whatever
    // was last done in this browser. See startSession.
    startSession()
    // Force a fresh ID token so any custom claim set since the last sign-in is
    // on it. The orgId claim is what lets Cloud Storage rules tell one tenant
    // from another, and a cached token can be up to an hour stale — which for a
    // just-approved member is the difference between reaching their own files
    // and being refused. Best-effort: a failure here must not block sign-in.
    await cred.user.getIdToken(true).catch(() => {})
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
    // Before the network call, not after: fbSignOut can fail or hang offline,
    // and the keys must be gone either way. onAuthStateChanged clears them too,
    // but only once it fires — which it will not do if this throws.
    clearKeyring()
    clearSharedSubscriptions()
    // Same reasoning, and the same order: a timestamp left behind is what the
    // next sign-in would be measured against.
    endSession()
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
    // Operator of the platform, not of this tenant. Deliberately NOT folded
    // into isAdmin: every admin-only screen in the product is about configuring
    // one organization, and the platform console is the one screen that is not.
    isPlatformAdmin: platformAdmin === true,
    platformAdminReady: platformAdmin !== null,
    moduleMap,
    modulesReady,
    moduleEnabled: (key) => isModuleEnabled(moduleMap, key),
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
