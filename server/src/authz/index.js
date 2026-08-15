// ─────────────────────────────────────────────────────────────────────────────
// The authorization core, wired to the real Firestore.
//
// The rest of what routes need — the guards, the assertions, the pure
// predicates — is re-exported here so a route imports its authorization from
// one place and nobody has to remember which of four files a check lives in.
//
// firebase-admin is resolved LAZILY, inside the request, for the reason
// src/firestore.js states: importing a module that merely mentions Firestore
// must not need credentials, or every unit test in the tree needs a service
// account. getDb() caches its own handle, so this costs one function call per
// request and nothing else.
// ─────────────────────────────────────────────────────────────────────────────

import { getDb } from '../firestore.js'
import { createCallerStore } from './caller.js'
import { createProfileStage } from './guards.js'

/**
 * The store, bound to the Admin SDK handle.
 *
 * ONE store, resolved once. Not because constructing it is expensive — it is
 * two closures — but because a per-request store invites a per-request `db`,
 * and the Admin SDK handle is the one object in this server that bypasses
 * firestore.rules. There should be exactly one of it and one place it is taken.
 */
let store = null

function callerStore() {
  if (!store) store = createCallerStore({ db: getDb() })
  return store
}

/** The middleware src/index.js mounts. See createProfileStage for what it refuses. */
export const requireProfile = createProfileStage({
  loadCaller: (uid, staleClaims) => callerStore().loadCaller(uid, staleClaims),
})

/**
 * Re-read the caller inside a transaction, immediately before the write.
 *
 * The middleware above ran before the handler; the write happens after. Rules
 * had no such gap — they evaluate against committed state at write time — and
 * this is what closes it. Pair it with an assert* from ./guards.js inside the
 * same transaction.
 */
export const reloadCaller = (caller, tx) => callerStore().reloadCaller(caller, tx)

export {
  requireOrgAccess,
  requireApprovedMember,
  requireWriter,
  requireManager,
  requireElevated,
  requireAdmin,
  assertOrgAccess,
  assertApprovedMember,
  assertWriter,
  assertManager,
  assertElevated,
  assertAdmin,
  orgIdFromParams,
} from './guards.js'

export {
  ROLES,
  ORG_PREDICATES,
  DENIED,
  isSignedIn,
  hasProfile,
  passwordIsOwn,
  isApprovedMemberOf,
  isWriterOf,
  isManagerOf,
  isElevatedOf,
  isAdminOf,
  denialReason,
  predicateFor,
  profileGateReason,
} from './policy.js'

export { AuthzError } from './errors.js'
export { buildCaller, readProfile, createCallerStore, USERS_COLLECTION } from './caller.js'
