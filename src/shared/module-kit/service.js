// ─────────────────────────────────────────────────────────────────────────────
// Generic org-scoped CRUD service for a module collection. Every module gets
// tenant-scoped reads/writes + automatic audit logging by calling
// createModuleService('<collection>'). Records live at
// /organizations/{orgId}/<collection> so the security rules isolate tenants.
//
// All reads/writes go through the data provider (src/shared/data) — this file
// no longer knows which database it is talking to.
// ─────────────────────────────────────────────────────────────────────────────
import { dataProvider } from '../data'
import { logAudit } from '../org/orgData'
import { AUDIT } from '../audit/audit'
import { reserveDocId } from '../docId/reserve'

export function createModuleService(collectionName, moduleKey = collectionName) {
  const path = (orgId) => `organizations/${orgId}/${collectionName}`

  return {
    collectionName,

    subscribe(orgId, cb) {
      return dataProvider.subscribe(
        path(orgId),
        { orderBy: ['createdAt', 'desc'], limit: 1000 },
        cb,
        // Fallback for records created before ordering existed / permission errors.
        () => cb([])
      )
    },

    async list(orgId) {
      return dataProvider.list(path(orgId), { orderBy: ['createdAt', 'desc'] })
    },

    async create(orgId, data, actor, label) {
      const id = await dataProvider.create(path(orgId), {
        ...data,
        docId: await reserveDocId(orgId, moduleKey),
        createdAt: dataProvider.serverTimestamp(),
        updatedAt: dataProvider.serverTimestamp(),
        createdBy: actor?.uid || null,
        createdByName: actor?.name || 'Unknown',
      })
      await logAudit(orgId, actor, AUDIT.CREATE, {
        module: moduleKey,
        target: collectionName,
        targetId: id,
        targetLabel: label || data.title || '',
        summary: `Created ${collectionName} "${label || data.title || id}"`,
      })
      return id
    },

    async update(orgId, id, data, actor, label) {
      await dataProvider.update(path(orgId), id, {
        ...data,
        updatedAt: dataProvider.serverTimestamp(),
      })
      await logAudit(orgId, actor, AUDIT.UPDATE, {
        module: moduleKey,
        target: collectionName,
        targetId: id,
        targetLabel: label || data.title || '',
      })
    },

    async setStatus(orgId, id, status, actor, label) {
      await dataProvider.update(path(orgId), id, {
        status,
        updatedAt: dataProvider.serverTimestamp(),
      })
      await logAudit(orgId, actor, AUDIT.STATUS, {
        module: moduleKey,
        target: collectionName,
        targetId: id,
        targetLabel: label || '',
        summary: `Status → ${status}`,
      })
    },

    async remove(orgId, id, actor, label) {
      await dataProvider.remove(path(orgId), id)
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
