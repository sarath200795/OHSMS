// ─────────────────────────────────────────────────────────────────────────────
// Firestore adapter — implements the data provider contract (see ../index.js).
//
// Collection paths are plain strings ('organizations/<orgId>/incidents') so the
// contract carries no Firestore types. This file is the only place in the
// module-kit data path that imports firebase/firestore.
// ─────────────────────────────────────────────────────────────────────────────
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit as fsLimit,
  onSnapshot,
  orderBy as fsOrderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../../firebase'

const segs = (path) => String(path).split('/').filter(Boolean)
const col = (path) => collection(db, ...segs(path))
const ref = (path, id) => doc(db, ...segs(path), id)

function buildQuery(path, opts = {}) {
  const parts = []
  if (opts.orderBy) parts.push(fsOrderBy(opts.orderBy[0], opts.orderBy[1] || 'asc'))
  if (opts.limit) parts.push(fsLimit(opts.limit))
  return parts.length ? query(col(path), ...parts) : col(path)
}

const docsOf = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }))

export default {
  name: 'firestore',

  /** Sentinel meaning "the backend's own clock", resolved at write time. */
  serverTimestamp: () => serverTimestamp(),

  subscribe(path, opts, cb, onError) {
    return onSnapshot(buildQuery(path, opts), (snap) => cb(docsOf(snap)), onError)
  },

  async list(path, opts) {
    return docsOf(await getDocs(buildQuery(path, opts)))
  },

  async create(path, data) {
    const created = await addDoc(col(path), data)
    return created.id
  },

  async update(path, id, data) {
    await updateDoc(ref(path, id), data)
  },

  async remove(path, id) {
    await deleteDoc(ref(path, id))
  },
}
