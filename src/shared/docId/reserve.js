// ─────────────────────────────────────────────────────────────────────────────
// Issuing the next document id.
//
// The counter lives in one document per org, `meta/docSeq`, with a field per
// kind. One document rather than one per kind because a transaction reads it
// once, and because the backfill and the admin screen both want the whole set.
//
// Reserving is a transaction, not a read-then-write. Two people raising a
// permit in the same second is ordinary, and the failure it would otherwise
// cause is two permits sharing a number — which is the one thing an identifier
// may not do, and which nothing downstream would detect.
//
// Numbers are consumed even when the record that asked for one fails to save.
// That is deliberate: a gap in the sequence is harmless, and the alternative —
// handing the same number out twice — is not.
// ─────────────────────────────────────────────────────────────────────────────
import { doc, getDoc, runTransaction, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { formatDocId, deriveOrgCode, normalizeOrgCode } from './format'

const seqRef = (orgId) => doc(db, 'organizations', orgId, 'meta', 'docSeq')
const orgRef = (orgId) => doc(db, 'organizations', orgId)

// The org code changes about never, and every create would otherwise read the
// org document to learn it.
const codeCache = new Map()

/** Forget cached codes — used after an admin edits one, and by tests. */
export function _clearOrgCodeCache() {
  codeCache.clear()
}

/**
 * The org's short code, from its `docCode` field, derived from its name if it
 * has never been set. Deriving rather than refusing means an org that predates
 * this gets sensible ids without an admin having to do anything first.
 */
export async function getOrgCode(orgId) {
  if (!orgId) return 'ORG'
  if (codeCache.has(orgId)) return codeCache.get(orgId)
  let code = 'ORG'
  try {
    const snap = await getDoc(orgRef(orgId))
    const data = snap.exists() ? snap.data() : {}
    code = normalizeOrgCode(data.docCode) || deriveOrgCode(data.name)
  } catch {
    // A create must not fail because the org document could not be read; the
    // fallback still produces a unique, well-formed id.
  }
  codeCache.set(orgId, code)
  return code
}

/** Set the org's code explicitly. Returns the normalised value actually stored. */
export async function setOrgCode(orgId, value) {
  const code = normalizeOrgCode(value)
  if (!code) throw new Error('A document code needs 2–5 letters or digits')
  await setDoc(orgRef(orgId), { docCode: code }, { merge: true })
  codeCache.set(orgId, code)
  return code
}

/**
 * Reserve the next id for a kind. Safe against concurrent callers.
 *
 * @param floor optional lowest acceptable number, used by the backfill so that
 *              ids issued after it continue past what it assigned.
 */
export async function reserveDocId(orgId, kind, { orgCode, floor = 0 } = {}) {
  const code = orgCode || (await getOrgCode(orgId))
  const seq = await runTransaction(db, async (tx) => {
    const snap = await tx.get(seqRef(orgId))
    const current = (snap.exists() && Number(snap.data()[kind])) || 0
    const next = Math.max(current, floor) + 1
    tx.set(seqRef(orgId), { [kind]: next }, { merge: true })
    return next
  })
  return formatDocId(kind, code, seq)
}

/** Every counter for an org, for the admin screen. */
export async function readCounters(orgId) {
  const snap = await getDoc(seqRef(orgId))
  return snap.exists() ? snap.data() : {}
}

/**
 * Move a counter forward, never back.
 *
 * The backfill calls this after numbering existing records. Clamping upward is
 * what stops a re-run — or a stale browser tab — from rewinding the counter and
 * handing out numbers that are already on documents.
 */
export async function raiseCounter(orgId, kind, to) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(seqRef(orgId))
    const current = (snap.exists() && Number(snap.data()[kind])) || 0
    if (to > current) tx.set(seqRef(orgId), { [kind]: to }, { merge: true })
  })
}
