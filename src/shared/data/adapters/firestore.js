// ─────────────────────────────────────────────────────────────────────────────
// Firestore adapter — implements the data provider contract (see ../index.js).
//
// Collection paths are plain strings ('organizations/<orgId>/incidents') so the
// contract carries no Firestore types, and stored values cross in both
// directions untouched: what a caller writes is what it reads back, Timestamps
// and all. Normalising that shape belongs to a migration, not to this file.
//
// Errors are rethrown verbatim — never wrapped, never swallowed. Callers branch
// on e.code ('permission-denied' vs 'unavailable' is the difference between a
// refusal and a dead connection), and isWriteRefused exists precisely because
// this adapter CANNOT tell a rules refusal from an exclusive-create collision.
// ─────────────────────────────────────────────────────────────────────────────
import {
  addDoc,
  arrayUnion as fsArrayUnion,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  increment as fsIncrement,
  limit as fsLimit,
  onSnapshot,
  orderBy as fsOrderBy,
  query,
  runTransaction as fsRunTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where as fsWhere,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../../firebase'

const segs = (path) => String(path).split('/').filter(Boolean)
const col = (path) => collection(db, ...segs(path))
const ref = (path, id) => doc(db, ...segs(path), id)

function buildQuery(path, opts) {
  const o = opts || {}
  const parts = []
  // where first, then order, then limit — the order the constraints read in,
  // and the order every hand-written query in the app already used.
  for (const w of o.where || []) parts.push(fsWhere(w.field, w.op, w.value))
  if (o.orderBy) parts.push(fsOrderBy(o.orderBy[0], o.orderBy[1] || 'asc'))
  if (o.limit) parts.push(fsLimit(o.limit))
  return parts.length ? query(col(path), ...parts) : col(path)
}

const docsOf = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }))

// A missing document is null, not an exception and not an empty object: the
// caller has to be able to tell "not there" from "there with no fields".
const docOf = (snap) => (snap.exists() ? { id: snap.id, ...snap.data() } : null)

// The arguments of a set, shared by the three places one can happen (direct,
// batched, transactional). SetOptions is passed only when merging: a bare
// two-argument set is what every existing call site sends for a wholesale
// replace, and that is the shape this seam has to keep sending.
const setArgs = (path, id, data, opts) =>
  (opts?.merge ? [ref(path, id), data, { merge: true }] : [ref(path, id), data])

export default {
  name: 'firestore',

  // ── Sentinels ──────────────────────────────────────────────────────────────

  /** Sentinel meaning "the backend's own clock", resolved at write time. */
  serverTimestamp: () => serverTimestamp(),

  /** Atomic numeric add. No read, so concurrent writers cannot lose a delta. */
  increment: (n) => fsIncrement(n),

  /** Append-if-absent, atomically. */
  arrayUnion: (...values) => fsArrayUnion(...values),

  // ── Reads ──────────────────────────────────────────────────────────────────

  async get(path, id) {
    return docOf(await getDoc(ref(path, id)))
  },

  async list(path, opts) {
    return docsOf(await getDocs(buildQuery(path, opts)))
  },

  async count(path, opts) {
    // The server-side aggregate: no documents are read, which is what keeps
    // this affordable at 5 000-employee scale. Never null here — Firestore
    // always supports it — and a refusal rejects rather than reporting zero.
    const snap = await getCountFromServer(buildQuery(path, opts))
    return snap.data().count
  },

  subscribe(path, opts, cb, onError) {
    return onSnapshot(buildQuery(path, opts), (snap) => cb(docsOf(snap)), onError)
  },

  subscribeDoc(path, id, cb, onError) {
    return onSnapshot(ref(path, id), (snap) => cb(docOf(snap)), onError)
  },

  // ── Writes ─────────────────────────────────────────────────────────────────

  newId(path) {
    // doc() with no id mints one client-side, with no network round trip — so
    // a payload can name the document it is being written beside.
    return doc(col(path)).id
  },

  async create(path, data) {
    const created = await addDoc(col(path), data)
    return created.id
  },

  async set(path, id, data, opts) {
    await setDoc(...setArgs(path, id, data, opts))
  },

  async createExclusive(path, id, data) {
    // NOT a get-then-set. This is one plain write, and firestore.rules is what
    // makes it exclusive: the paths this is used on grant `create` and nothing
    // else, so a second write to the same id is refused by the server with
    // nothing able to interleave. That also means a collision arrives as
    // 'permission-denied' rather than 'already-exists' — see isWriteRefused.
    //
    // On a path WITHOUT such a rule this degrades to an ordinary set, silently.
    // Adding a caller means adding the rule in the same change.
    await setDoc(ref(path, id), data)
  },

  async update(path, id, data) {
    // Rejects when the document does not exist (Firestore 'not-found'), which
    // callers depend on — see the note on update in ../index.js.
    await updateDoc(ref(path, id), data)
  },

  async remove(path, id) {
    await deleteDoc(ref(path, id))
  },

  // ── Composition ────────────────────────────────────────────────────────────

  batch() {
    const b = writeBatch(db)
    return {
      set: (path, id, data, opts) => { b.set(...setArgs(path, id, data, opts)) },
      update: (path, id, data) => { b.update(ref(path, id), data) },
      remove: (path, id) => { b.delete(ref(path, id)) },
      // Same reasoning as createExclusive above: a batched set on a create-only
      // path. Being in the batch is the point — the fire defect lock and the
      // report it guards land together or not at all.
      createExclusive: (path, id, data) => { b.set(ref(path, id), data) },
      commit: () => b.commit(),
    }
  },

  runTransaction(fn) {
    // async so the SDK always receives a Promise, whatever fn returns. Reads
    // still have to precede writes — that is Firestore's rule, and every call
    // site in this app is already written that way.
    return fsRunTransaction(db, async (tx) =>
      fn({
        get: async (path, id) => docOf(await tx.get(ref(path, id))),
        set: (path, id, data, opts) => { tx.set(...setArgs(path, id, data, opts)) },
        update: (path, id, data) => { tx.update(ref(path, id), data) },
      }))
  },

  // ── Errors ─────────────────────────────────────────────────────────────────

  /**
   * "The backend refused this write." Both codes, because Firestore cannot
   * separate them: a create-only rule turns a duplicate into permission-denied,
   * so a caller that branched on only one of the two would misread every
   * duplicate defect report as a system fault (or the reverse).
   */
  isWriteRefused: (e) => e?.code === 'permission-denied' || e?.code === 'already-exists',
}
