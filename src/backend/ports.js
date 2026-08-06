// ─────────────────────────────────────────────────────────────────────────────
// The ports: what any backend must provide.
//
// The app's business invariants — the document-id counter, the defect lock,
// tenancy scoping — live in src/backend/core and speak ONLY to these
// interfaces. Connecting a client's own database means implementing DataPort;
// their file store means implementing StoragePort. Nothing in core, and nothing
// in the app above it, knows which provider is underneath.
//
// The contracts are deliberately tiny. A port is easy to implement exactly in
// proportion to how little it demands, and these demand the four primitives
// the invariants actually rest on:
//
//   get / set / delete      — plain document access by org-scoped path
//   runTransaction          — read-modify-write that cannot interleave
//   createExclusive         — create that FAILS if the document exists
//   batch                   — several writes that land or fail together
//
// createExclusive is the one that carries security weight: the defect lock is
// nothing but "a create that fails on collision". A provider whose exclusive
// create is check-then-set without isolation has not implemented this port,
// however well the tests pass on a quiet day.
//
// ── Tenancy ──────────────────────────────────────────────────────────────────
// Every path a port receives is built by orgPath() below, so a provider only
// ever sees addresses inside one organization's namespace. That makes tenancy
// structural at this layer — core code cannot even express a cross-org read.
// It is NOT, on its own, enforcement: with the shipped Firebase provider the
// browser talks straight to Firestore and the security RULES are what an
// attacker cannot bypass. A client adapter that fronts their own database must
// bring its own enforcement (typically: this same core running behind their
// API, with their auth middleware doing what the rules do here). The seam
// makes the swap clean; it does not make that responsibility disappear.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An org-scoped document path. The only path shape core code ever builds.
 * Segments are validated so a hostile value cannot climb out of the org.
 */
export function orgPath(orgId, ...segments) {
  const all = [orgId, ...segments]
  for (const s of all) {
    if (typeof s !== 'string' || !s.length) throw new Error('orgPath: empty segment')
    if (s.includes('/')) throw new Error('orgPath: segment may not contain "/"')
  }
  // Path depth alternates collection/document; core callers pass an even
  // number of segments after orgId so paths always address a document.
  if (segments.length % 2 !== 0) throw new Error('orgPath: must address a document')
  return `organizations/${all.join('/')}`
}

/* eslint-disable no-unused-vars -- signatures document the contract */

/**
 * @typedef {Object} DataPort
 * @property {(path: string) => Promise<object|null>} get
 *    The document's data, or null when it does not exist.
 * @property {(path: string, data: object, opts?: {merge?: boolean}) => Promise<void>} set
 * @property {(path: string) => Promise<void>} delete
 *    Deleting a missing document is not an error.
 * @property {(path: string, data: object) => Promise<void>} createExclusive
 *    MUST throw (code 'already-exists' or 'permission-denied') when the
 *    document exists — atomically, not check-then-set.
 * @property {(fn: (tx: Tx) => Promise<any>) => Promise<any>} runTransaction
 *    fn may run more than once; it must not have side effects beyond tx.
 * @property {() => Batch} batch
 * @property {() => object} serverTimestamp
 *    The provider's write-time timestamp sentinel.
 */

/**
 * @typedef {Object} Tx
 * @property {(path: string) => Promise<object|null>} get
 * @property {(path: string, data: object, opts?: {merge?: boolean}) => void} set
 */

/**
 * @typedef {Object} Batch
 * @property {(path: string, data: object) => void} createExclusive
 * @property {(path: string, data: object, opts?: {merge?: boolean}) => void} set
 * @property {(path: string) => void} delete
 * @property {() => Promise<void>} commit  All-or-nothing.
 */

/**
 * @typedef {Object} StoragePort
 * @property {(path: string, blob: Blob) => Promise<{url: string}>} put
 *    Store bytes at an org-scoped path; return a fetchable URL.
 * @property {(path: string) => Promise<void>} remove
 *    Removing a missing object is not an error.
 */

/* eslint-enable no-unused-vars */
