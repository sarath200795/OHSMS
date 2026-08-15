// ─────────────────────────────────────────────────────────────────────────────
// Who is asking — assembled the way firestore.rules assembles it.
//
// THE DECISION THIS FILE IS. A rule evaluates myProfile() as a LIVE
// get(/users/{uid}) on every single evaluation (firestore.rules:30-32). That is
// why revocation in this app is instant: the moment an admin sets status to
// something other than 'approved', or flips a role, the next rule evaluation
// sees it. The ID token does not work that way. Its custom claims are minted by
// functions/lib/claims.js and are up to an HOUR stale, and the refresh-token
// revocation that would shorten that window only fires on two transitions
// (claims.js:85-103). It does NOT fire on:
//
//   - member → auditor. wasElevated is false, so nothing is revoked. A server
//     that branched on the role claim would let a freshly-demoted auditor write
//     for the rest of the hour — precisely the failure isWriterOf exists to
//     close (firestore.rules:81-89).
//   - mustChangePassword being set. It is not a claim key at all
//     (claims.js:24), so a provisioned account's token looks perfectly healthy
//     while passwordIsOwn() denies it everything.
//   - any change to siteId or access, which decide document visibility.
//
// So this file reads the profile. Every request.
//
// THE COST, STATED HONESTLY. One extra Firestore document read per request,
// roughly a millisecond in-region, billed. Three things make it the right
// trade:
//   1. It is the same read the rules were already doing — several times per
//      request in fact, once per rule evaluation — so moving a write to this
//      server makes it CHEAPER, not dearer.
//   2. This server owns WRITES only. Reads stay as client-side onSnapshot
//      listeners governed by rules, so the read never lands here and the
//      request rate through this path is low.
//   3. The alternative is a cache with an invalidation story, and the thing
//      being cached is the answer to "may this person still do this". The fast
//      path IS the vulnerability.
//
// There is deliberately no cache, no TTL, and no "trust the claim when it
// agrees with the profile" shortcut.
//
// WHAT THIS FILE DOES NOT DO. It does not verify tokens. src/auth.js does that
// and hands on `{ uid, staleClaims }`. One verifier, deliberately: a second
// would be a second way to authenticate, and the day a route is wired to the
// wrong one is the day the checks stop meaning what the router says they mean.
// ─────────────────────────────────────────────────────────────────────────────

export const USERS_COLLECTION = 'users'

/**
 * Read /users/{uid}, optionally inside a transaction.
 *
 * Returns null for a missing document rather than throwing, which is what makes
 * hasProfile() deny instead of the request erroring — parity with the exists()
 * guard at firestore.rules:34-37.
 */
export async function readProfile(db, uid, { tx = null, usersCollection = USERS_COLLECTION } = {}) {
  const ref = db.collection(usersCollection).doc(uid)
  const snap = tx ? await tx.get(ref) : await ref.get()
  return snap.exists ? snap.data() : null
}

/**
 * Freeze a caller into the shape policy.js expects.
 *
 * `staleClaims` is named that way on purpose, and src/auth.js names it the same
 * for the same reason. The claims are worth carrying — useful in a log line,
 * worth asserting against the profile if we ever want to measure how often they
 * diverge — but they are never an input to a decision. A reviewer who sees
 * `staleClaims.role` inside an `if` knows immediately that it is wrong, which a
 * field called `claims` would not tell them.
 */
export function buildCaller({ uid, profile, staleClaims = {} }) {
  return Object.freeze({
    uid,
    profile: profile || null,
    staleClaims: Object.freeze({
      orgId: (staleClaims && staleClaims.orgId) ?? null,
      role: (staleClaims && staleClaims.role) ?? null,
    }),
  })
}

/**
 * The profile reads a request needs, bound to one Firestore handle.
 *
 * `db` is injected rather than imported so this module holds no firebase-admin
 * reference and the whole authorization core stays unit testable with plain
 * objects. src/authz/index.js binds the real one.
 */
export function createCallerStore({ db, usersCollection = USERS_COLLECTION }) {
  /**
   * Turn the verified `{ uid, staleClaims }` from src/auth.js into a caller.
   *
   * Read ONCE per request and threaded through from here. Rules cache get()
   * within a single evaluation so every helper sees one consistent snapshot
   * (firestore.rules:675-681); two independent reads in one request could
   * straddle a mid-request demotion and let a route pass a writer check and a
   * manager check against two different people's authority.
   */
  async function loadCaller(uid, staleClaims) {
    const profile = await readProfile(db, uid, { usersCollection })
    return buildCaller({ uid, profile, staleClaims })
  }

  /**
   * Re-read the profile inside a transaction, for the write itself.
   *
   * Rules evaluate against committed state AT WRITE TIME. A server that checks
   * in middleware and writes afterwards has opened a window the rules do not
   * have: an admin revoking someone mid-request loses the race, and the write
   * lands. Re-reading through the transaction closes it — the transaction
   * retries if the profile changed underneath, so the check and the write agree
   * or neither happens.
   *
   * This does not re-verify the token. A token that was valid one Firestore
   * read ago has not expired since, and a second Auth round-trip inside a
   * transaction is a round-trip where they cost the most.
   */
  async function reloadCaller(caller, tx) {
    const uid = caller && caller.uid
    if (!uid) throw new Error('reloadCaller called without a verified caller')
    const profile = await readProfile(db, uid, { tx, usersCollection })
    return buildCaller({ uid, profile, staleClaims: caller.staleClaims })
  }

  return { loadCaller, reloadCaller }
}
