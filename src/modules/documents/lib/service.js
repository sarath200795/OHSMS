// ─────────────────────────────────────────────────────────────────────────────
// The documents service: the generic module service, with reads narrowed.
//
// Writes, audit logging and doc-id reservation are unchanged — they come
// straight from createModuleService. Only `subscribe` is replaced, because a
// site-scoped library cannot ask for the whole collection any more. See
// readScope.js for why, and firestore.rules for the rule it mirrors.
// ─────────────────────────────────────────────────────────────────────────────

import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore'
import { db } from '../../../shared/firebase'
import { createModuleService } from '../../../shared/module-kit/service'
import { readPlan, mergeResults } from './readScope'

const MAX = 1000

const base = createModuleService('documents', 'documents')

export const documentsService = {
  ...base,

  /**
   * @param viewer { role, sites } — sites being the ones already visible to
   *        them, so the query can never ask for a site the rule would refuse.
   */
  subscribe(orgId, cb, viewer = {}) {
    if (!orgId) return () => {}
    const col = collection(db, 'organizations', orgId, 'documents')
    const plan = readPlan(viewer.role, viewer.sites)

    // Each query keeps its own slot, so a late snapshot from one cannot drop
    // the rows another has already delivered.
    const parts = plan.map(() => null)
    const emit = () => cb(mergeResults(parts))

    const unsubs = plan.map((p, i) => {
      const q = p.field
        ? query(col, where(p.field, p.op, p.value), orderBy('createdAt', 'desc'), limit(MAX))
        : query(col, orderBy('createdAt', 'desc'), limit(MAX))

      return onSnapshot(
        q,
        (snap) => {
          parts[i] = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          emit()
        },
        (err) => {
          // The generic service turns a read failure into an empty list, which
          // is how a broken query reads as an empty library. Say it out loud
          // instead, and let the other queries keep their rows.
          // eslint-disable-next-line no-console
          console.error(
            `[Documents] ${p.field ? `${p.field} ${p.op}` : 'unfiltered'} listener failed:`,
            err?.message || err
          )
          parts[i] = []
          emit()
        }
      )
    })

    return () => unsubs.forEach((u) => u && u())
  },
}
