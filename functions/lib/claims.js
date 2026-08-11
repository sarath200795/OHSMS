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
