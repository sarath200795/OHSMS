// ─────────────────────────────────────────────────────────────────────────────
// Issuing the next document id, server side.
//
// THE RULE THIS REPLACES (firestore.rules:909-920):
//
//   read:   isApprovedMemberOf(orgId)
//   create: isWriterOf(orgId) && keys().hasOnly(['n']) && n is int && n > 0
//   update: isWriterOf(orgId) && keys().hasOnly(['n']) && n is int
//                             && n > resource.data.n        ← STRICTLY greater
//   delete: if false
//
// Every clause of it is load-bearing and each has its own failure attached:
//
//   - STRICTLY greater. An equal write is refused outright, because a replayed
//     write that re-issued the same number is exactly the failure the counter
//     exists to prevent (src/shared/docId/reserve.js:137-146 guards for it on
//     the client for the same reason).
//   - hasOnly(['n']). The write is a full REPLACE, not a merge, so this uses
//     `.set()` with the whole document rather than a field update.
//   - One document per kind. Rules cannot compare a dynamically-named field, so
//     the pre-split shape — one document with a field per kind — fell under the
//     generic member rule and any approved member could set it backwards
//     (firestore.rules:893-908).
//   - isWriterOf, not isApprovedMemberOf. An auditor bumping a counter burns a
//     reference number that gets quoted to a regulator (906-908). That check is
//     the caller's: this module is handed a transaction that has already
//     asserted it, and the counter write rides in the same transaction so the
//     two commit or abort together.
//   - delete: false. Deleting the document resets the counter to zero, which is
//     rewinding it by another name. Nothing here deletes and no route exposes it.
//
// WHAT IS DIFFERENT FROM THE CLIENT, AND WHY.
//
// 1. THE RESERVATION SHARES THE CALLER'S TRANSACTION. On the client
//    reserveDocId is its own transaction, so a number is consumed even when the
//    record that asked for it fails to save — deliberate, because a gap is
//    harmless and a duplicate is not (reserve.js:13-15). Here the record and
//    the counter commit together, which is strictly better: still never twice,
//    and no gap. It also means the whole submit is one atomic act rather than
//    two, which is what lets the authorization check and the write agree.
//
// 2. NOTHING IS CACHED. The client caches the org code and the legacy counter
//    per tab (reserve.js:38, 101). A Cloud Run instance lives for hours and
//    serves EVERY tenant, so the same cache would keep printing a stale
//    reference code on real documents long after an admin corrected it, across
//    all of them. Two extra document reads per record created is not a price
//    worth a cache with an invalidation story.
// ─────────────────────────────────────────────────────────────────────────────
import { deriveOrgCode, formatDocId, normalizeOrgCode } from './docId.js'

export const SEQ_COLLECTION = 'docSeq'

/** The pre-split counter, one document with a field per kind. Read to seed. */
const LEGACY_SEQ = { collection: 'meta', doc: 'docSeq' }

/**
 * A stored counter, read as a whole number this side of zero.
 *
 * The rule pins `n is int` (firestore.rules:917), so a fraction in there was
 * never written by a client — only the Admin SDK, which evaluates no rules, can
 * have put it there. CEILING rather than floor, because the question a corrupt
 * counter poses is which numbers might already be printed on a document, and
 * rounding up is the only answer that cannot re-issue one. Anything unreadable
 * — a string, a null, a NaN — is zero, which reserves 1 and moves the counter
 * forward rather than failing the submit the number was for.
 */
const counterValue = (raw) => {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0
}

/**
 * Reserve the next id for a kind, inside a transaction the caller owns.
 *
 * READS ONLY — until the single `tx.set` at the end, which is a write. Firestore
 * requires every read in a transaction to precede every write, so this must be
 * called before the caller writes the document the id belongs to. Getting that
 * order wrong fails loudly at the emulator rather than quietly in production.
 *
 * @param tx     the Admin SDK transaction, already carrying the caller's
 *               re-read profile and the assertion made against it
 * @param floor  the lowest acceptable number, for a backfill that has already
 *               numbered existing records and must continue past them
 */
export async function reserveDocId(tx, db, { orgId, kind, floor = 0 }) {
  if (!orgId || !kind) throw new Error('reserveDocId needs an orgId and a kind')

  const orgRef = db.collection('organizations').doc(orgId)
  const seqRef = orgRef.collection(SEQ_COLLECTION).doc(kind)
  const legacyRef = orgRef.collection(LEGACY_SEQ.collection).doc(LEGACY_SEQ.doc)

  // One round trip for the three. All inside the transaction, unlike the
  // client, which reads the legacy counter outside because a retry would repeat
  // it — a saving worth having in a browser and not worth the extra reasoning
  // in a request that is already a transaction.
  const [orgSnap, seqSnap, legacySnap] = await tx.getAll(orgRef, seqRef, legacyRef)

  const org = orgSnap.exists ? orgSnap.data() : {}
  // Derived from the name when it has never been set, so an org that predates
  // the scheme gets sensible ids without an admin having to do anything first.
  const code = normalizeOrgCode(org.docCode) || deriveOrgCode(org.name)

  const current = counterValue(seqSnap.exists && seqSnap.data().n)
  const legacyFloor = counterValue(legacySnap.exists && legacySnap.data()[kind])
  const next = Math.max(current, legacyFloor, counterValue(floor)) + 1

  // The rule's own clause, restated where it can actually be violated. It
  // cannot be reached by the arithmetic above; it is here because the arithmetic
  // is what a later edit changes, and a counter that stops being monotonic is
  // not visible until two records are found sharing a number months later.
  if (!Number.isInteger(next) || next <= current) {
    throw new Error(`docSeq for ${kind} would not advance (${current} -> ${next})`)
  }

  // Not merge, and the whole document: the rule pins the key set to exactly
  // { n }, so anything else stored beside it would be refused by the rule the
  // day a client writes this counter directly — which, during the migration, is
  // every module that has not moved yet.
  tx.set(seqRef, { n: next })

  return formatDocId(kind, code, next)
}
