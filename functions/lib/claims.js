// ─────────────────────────────────────────────────────────────────────────────
// Which custom claims a user's ID token should carry.
//
// WHY THIS EXISTS. Cloud Storage rules cannot read Firestore, so they have no
// way to learn which organization the caller belongs to — which is why
// storage.rules currently captures {orgId} in the path and checks nothing, and
// why any signed-in user of any tenant can reach any other tenant's files
// (SECURITY.md S-01). The only thing a Storage rule can read is the token. So
// the org has to be ON the token, and only the Admin SDK can put it there.
//
// THE RULE THAT MATTERS: only an APPROVED member carries an orgId claim.
//
// A pending joiner already has a /users document naming an org — that is how
// they wait for approval — and if that alone minted a claim, anyone could sign
// up naming a tenant and immediately read its files. Approval is the gate
// everywhere else in this app and it is the gate here. Likewise, a member whose
// status is revoked must lose the claim, not keep it until they next sign in.
//
// Everything here is pure so the decision can be tested without the Admin SDK,
// which is the part that cannot run in a unit test.
// ─────────────────────────────────────────────────────────────────────────────

/** The keys this system owns. Anything else on the token is left alone. */
export const CLAIM_KEYS = ['orgId', 'role']

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * The claims a profile should produce.
 *
 * Returns nulls rather than omitting keys: setCustomUserClaims replaces the
 * whole object, and an explicit null is what removes a claim that was there
 * before. Omitting the key would leave a revoked user holding their old org.
 */
export function claimsFor(profile) {
  const approved = profile && profile.status === 'approved'
  if (!approved) return { orgId: null, role: null }
  return { orgId: str(profile.orgId), role: str(profile.role) }
}

/**
 * Has anything this system owns actually changed?
 *
 * Every setCustomUserClaims invalidates the client's cached token and makes it
 * refetch. The /users document is written for all sorts of reasons — a name
 * edit, a department, an access request — and re-stamping identical claims on
 * each of those would churn every session in the org for no reason.
 */
export function claimsChanged(existing, next) {
  const before = existing || {}
  return CLAIM_KEYS.some((k) => (before[k] ?? null) !== (next[k] ?? null))
}

/**
 * Merge onto whatever else is on the token.
 *
 * Claims are replaced wholesale, so anything set by another system — App Check,
 * a future feature — has to be carried across or this silently deletes it.
 */
export function mergeClaims(existing, next) {
  return { ...(existing || {}), ...next }
}

/** True when the user should be able to reach an org's files at all. */
export const isScoped = (claims) => Boolean(claims && str(claims.orgId))

/**
 * Does this change REDUCE what the token can reach?
 *
 * Firestore re-reads the profile on every rule evaluation, so a revoked member
 * loses Firestore access the instant the document changes. Cloud Storage does
 * not: storage.rules reads orgId and role off the presented TOKEN, and an ID
 * token stays valid for up to an hour. So a member who is suspended, moved, or
 * demoted keeps whatever Storage access their cached token still claims —
 * including, before the role fix, the ability to delete every file in the org.
 *
 * Revoking refresh tokens closes that window: the SDK cannot mint a new ID
 * token, so access ends when the current one expires rather than whenever the
 * person next signs in.
 *
 * Deliberately NOT fired on every claim change. Promotion and a first approval
 * both change claims while granting more, and forcing a re-authentication there
 * would interrupt somebody mid-task for no security gain. Only reductions.
 */
export function revokesAccess(before, next) {
  const had = (before || {}).orgId ?? null
  const now = (next || {}).orgId ?? null

  // Membership withdrawn, or moved to a different tenant. The second matters as
  // much as the first: a stale token still names the OLD org, so until it
  // expires the person can reach the files of a tenant they have left.
  if (had && had !== now) return true
  if (!had) return false

  // Same org, less authority — decided by comparing the RIGHTS rather than by
  // testing one hardcoded role list.
  //
  // It used to ask only "were they admin/manager, and are they no longer?",
  // which models the delete right and nothing else. storage.rules gates two
  // different things on role, and the second one was missed entirely: a member
  // demoted to AUDITOR loses the right to write (canWriteTo excludes auditors)
  // while never having been elevated, so no reduction was detected and no
  // session was revoked. The auditor is described in firestore.rules as an
  // outside party given a login to inspect the safety record — and for up to an
  // hour after being made one, they could still upload into the tenant on a
  // stale `member` claim.
  const was = storageRights((before || {}).role)
  const is = storageRights((next || {}).role)
  return (was.write && !is.write) || (was.remove && !is.remove)
}

/**
 * What `storage.rules` actually grants a role.
 *
 * One mapping, in one place, because two enforcement surfaces disagreeing about
 * the same person is precisely how S-01 happened — and how the auditor gap
 * above survived a green test suite. If storage.rules changes what a role may
 * do, this changes with it, and `revokesAccess` follows for free.
 *
 * These mirror the RULE as written, not the intent behind it. An unknown or
 * absent role returns write:true because `myRole() != 'auditor'` is true for
 * the empty string — that is what the deployed rule does, and a model that
 * quietly disagreed with it would be worse than no model. The case it seems to
 * miss (a revoked user, whose role is null) is caught by the org check above
 * before this is ever consulted.
 */
export function storageRights(role) {
  const r = typeof role === 'string' ? role : ''
  return {
    // canWriteTo(): an auditor reads the record, never edits it.
    write: r !== 'auditor',
    // isManagerIn(): deleting anything, and reading a medical record.
    remove: r === 'admin' || r === 'manager',
  }
}
