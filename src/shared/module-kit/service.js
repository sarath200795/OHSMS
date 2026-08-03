// ─────────────────────────────────────────────────────────────────────────────
// Generic org-scoped CRUD service for a module collection. Every module gets
// tenant-scoped reads/writes + automatic audit logging by calling
// createModuleService('<collection>'). Records live at
// /organizations/{orgId}/<collection> so the security rules isolate tenants.
// ─────────────────────────────────────────────────────────────────────────────
import {
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore'
import { moduleCol, moduleDoc, logAudit } from '../org/orgData'
import { AUDIT } from '../audit/audit'
import { reserveDocId } from '../docId/reserve'

export function createModuleService(collectionName, moduleKey = collectionName) {
  const col = (orgId) => moduleCol(orgId, collectionName)
  const ref = (orgId, id) => moduleDoc(orgId, collectionName, id)

  return {
    collectionName,

    subscribe(orgId, cb) {
      const q = query(col(orgId), orderBy('createdAt', 'desc'))
      // Fallback for records created before ordering existed / permission errors.
      return onSnapshot(
        q,
        (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        () => cb([])
      )
    },

    async list(orgId) {
      const snap = await getDocs(query(col(orgId), orderBy('createdAt', 'desc')))
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    },

    async create(orgId, data, actor, label) {
      const created = await addDoc(col(orgId), {
        ...data,
        docId: await reserveDocId(orgId, moduleKey),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: actor?.uid || null,
        createdByName: actor?.name || 'Unknown',
      })
      await logAudit(orgId, actor, AUDIT.CREATE, {
        module: moduleKey,
        target: collectionName,
        targetId: created.id,
        targetLabel: label || data.title || '',
        summary: `Created ${collectionName} "${label || data.title || created.id}"`,
      })
      return created.id
    },

    async update(orgId, id, data, actor, label) {
      await updateDoc(ref(orgId, id), { ...data, updatedAt: serverTimestamp() })
      await logAudit(orgId, actor, AUDIT.UPDATE, {
        module: moduleKey,
        target: collectionName,
        targetId: id,
        targetLabel: label || data.title || '',
      })
    },

    async setStatus(orgId, id, status, actor, label) {
      await updateDoc(ref(orgId, id), { status, updatedAt: serverTimestamp() })
      await logAudit(orgId, actor, AUDIT.STATUS, {
        module: moduleKey,
        target: collectionName,
        targetId: id,
        targetLabel: label || '',
        summary: `Status → ${status}`,
      })
    },

    async remove(orgId, id, actor, label) {
      await deleteDoc(ref(orgId, id))
      await logAudit(orgId, actor, AUDIT.DELETE, {
        module: moduleKey,
        target: collectionName,
        targetId: id,
        targetLabel: label || '',
        summary: `Deleted ${collectionName} "${label || id}"`,
      })
    },
  }
}
