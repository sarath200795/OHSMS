// ─────────────────────────────────────────────────────────────────────────────
// Database seam — the one door between module CRUD and the actual database.
//
// The provider contract (all paths are strings like 'organizations/<org>/x'):
//
//   serverTimestamp()                          backend-clock sentinel for writes
//   subscribe(path, opts, cb, onError) -> fn   live collection feed, returns
//                                              unsubscribe; opts { orderBy:
//                                              [field, 'asc'|'desc'], limit }
//   list(path, opts)        -> [{id, ...}]     one-shot read
//   create(path, data)      -> id
//   update(path, id, data)  -> void
//   remove(path, id)        -> void
//
// Which implementation backs it comes from VITE_DATA_DRIVER (default
// 'firestore'). Adding a backend = one adapter file implementing the contract
// plus a line in DRIVERS. See ./README.md for what a migration involves beyond
// this seam (auth, security rules, realtime, offline).
// ─────────────────────────────────────────────────────────────────────────────
import firestore from './adapters/firestore'

const DRIVER = String(import.meta.env.VITE_DATA_DRIVER || 'firestore')
  .trim()
  .toLowerCase()

// Static registry (not dynamic imports): subscribe() must return an
// unsubscribe function synchronously, which an async-loaded adapter cannot do
// without every caller changing shape.
const DRIVERS = {
  firestore,
  // supabase: supabaseAdapter,   ← future adapters register here
}

export const dataDriver = DRIVER in DRIVERS ? DRIVER : 'firestore'
export const dataProvider = DRIVERS[dataDriver]
