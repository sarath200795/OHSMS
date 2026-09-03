import { doc } from 'firebase/firestore'
import { db } from '../../../shared/firebase'

// ─────────────────────────────────────────────────────────────────────────────
// One document per padlock that is currently applied, anywhere in the org.
//
// Why this exists at all: uniqueness of a lock number was enforced in two
// places, and neither of them was the one that matters.
//
//   • setPointLock's transaction checked the procedure document it had just
//     read — so it caught "this lock is already on ANOTHER POINT of this same
//     machine" and nothing else.
//   • OperateProcedure computed collectInUseLockNos(procedures) in the browser
//     and greyed the lock out of the picker.
//
// Two operators on two DIFFERENT procedures therefore both saw lock #12 free,
// both committed, and neither transaction noticed: they read different
// documents, so there was no contention for Firestore to detect. The browser
// check could not save it either — it is a different tab, and it silently sees
// less than the truth anyway, because useOrgProcedures truncates at
// COLLECTION_READ_CAP and a locked procedure past the cap is simply absent from
// the set.
//
// The result is the failure mode LOTO exists to prevent: one physical padlock
// recorded as isolating two machines, and a technician who removes "their" lock
// from one of them energising the other.
//
// A claim document turns that into contention Firestore CAN see. The lock
// number is the document ID, so two transactions claiming the same padlock are
// two transactions writing the same document — one wins, the other retries and
// then fails the existence check. It is the same trick /defectLocks already
// uses in the fire module, and the same reason the ID carries the value rather
// than the value living in a field: a field can be duplicated, a document ID
// cannot.
//
// Scoped by org because padlock numbering is per-organization; two tenants may
// both own a lock stamped "12" and they are not the same padlock.
// ─────────────────────────────────────────────────────────────────────────────

export const LOCK_CLAIMS = 'lockClaims'

/**
 * Document ID for a padlock. Firestore IDs may not contain '/', and lock
 * numbers are user-entered strings ("D-14", "12", "Blue/3"), so the separator
 * has to survive whatever gets typed. '__' is the same separator the injury
 * records use for `${incidentId}__${personId}`.
 */
export function lockClaimId(orgId, lockNo) {
  return `${orgId}__${String(lockNo).trim().replace(/\//g, '∕')}`
}

export const lockClaimRef = (orgId, lockNo) => doc(db, LOCK_CLAIMS, lockClaimId(orgId, lockNo))

/**
 * Read every claim a transaction is about to touch, BEFORE it writes anything.
 *
 * Firestore transactions refuse a read issued after a write, so callers cannot
 * discover a lock number half way through building their update and then check
 * it. Every path here therefore works out its full set of lock numbers first —
 * the ones it is claiming and the ones it is releasing — and reads them in one
 * go.
 *
 * Duplicates in `lockNos` are collapsed: reading the same ref twice in a
 * transaction is legal but pointless, and the callers below genuinely can
 * produce the same number twice (a swap releases and re-claims one).
 *
 * @returns {Promise<Map<string, {exists: boolean, data: object|null}>>}
 */
export async function readLockClaims(tx, orgId, lockNos) {
  const unique = [...new Set(lockNos.filter(Boolean).map(String))]
  const out = new Map()
  for (const no of unique) {
    // Sequential rather than Promise.all: the Firestore transaction API
    // serialises reads anyway, and a rejected member of a Promise.all inside a
    // transaction produces an unhandled rejection alongside the real error.
    // eslint-disable-next-line no-await-in-loop
    const snap = await tx.get(lockClaimRef(orgId, no))
    out.set(no, { exists: snap.exists(), data: snap.exists() ? snap.data() : null })
  }
  return out
}

/**
 * Is this padlock free for `procedureId` to take?
 *
 * A claim held by the SAME procedure is not a conflict — re-locking a point
 * that already carries the number, or a personal→department swap that ends up
 * on the same lock, must not fail. A claim held by any other procedure is.
 */
export function claimConflict(claims, lockNo, procedureId) {
  const claim = claims.get(String(lockNo))
  if (!claim?.exists) return null
  if (claim.data?.procedureId === procedureId) return null
  return claim.data || {}
}

/**
 * Does `procedureId` currently hold this padlock's claim?
 *
 * Every release path has to ask this before deleting. A blind delete is the
 * duplicate-lock bug wearing a different hat: unlocking a point preserves its
 * `techLockNo` for the history, and setPointLock does not require the point to
 * be locked, so a second unlock — a double-click, a stale tab, a retry — would
 * happily delete claim `org__12` even though procedure B has since taken lock
 * 12 for a different machine. Legacy points locked before claims existed have
 * the same shape: no claim of their own, and a delete that lands on someone
 * else's. The rules cannot catch it either, because releasing is open to any
 * writer in the org by design (a padlock outlives the shift that applied it).
 */
export function claimHeldBy(claims, lockNo, procedureId) {
  const claim = claims.get(String(lockNo))
  return !!claim?.exists && claim.data?.procedureId === procedureId
}

/** Message for a conflict, naming where the padlock actually is. */
export function lockHeldMessage(lockNo, claim) {
  const where = [claim?.equipment, claim?.site].filter(Boolean).join(' · ')
  // The location is the whole point of the message: "already in use" sends
  // someone hunting, "already on Press 4 · Hosur" sends them to the machine.
  return where
    ? `Lock ${lockNo} is already applied to ${where}. Remove it there first.`
    : `Lock ${lockNo} is already applied elsewhere in this organization.`
}

/** Body of a claim. `at` is a plain ISO string — serverTimestamp() in a
 *  transaction is fine, but this document is also read back for the message
 *  above and a pending sentinel reads as null. */
export function claimBody({ orgId, lockNo, procedureId, procedure, label, techName, by }) {
  return {
    orgId,
    lockNo: String(lockNo),
    procedureId,
    equipment: procedure?.equipment || '',
    site: procedure?.site || '',
    procedureCode: procedure?.procedureCode || '',
    label: label || '',
    techName: techName || '',
    by: by || null,
    at: new Date().toISOString(),
  }
}
