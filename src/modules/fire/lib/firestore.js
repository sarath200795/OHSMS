// ─────────────────────────────────────────────────────────────────────────────
// All Firestore access goes through here: org-scoped paths, batch helpers, and
// the public QR mirror kept in sync with every extinguisher write.
// ─────────────────────────────────────────────────────────────────────────────
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc as _setDoc,
  addDoc as _addDoc,
  updateDoc as _updateDoc,
  deleteDoc as _deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  writeBatch as _writeBatch,
  limit,
  startAfter,
  increment,
} from 'firebase/firestore'
import { db } from '../firebase'

// ── Read-only demo guard ─────────────────────────────────────────────────────
// When the demo account is signed in, every Firestore write is blocked
// client-side so the shared sample data stays pristine for the next visitor.
// Reads (subscribe*/get*/list*/query*) are untouched. Wrapping the write
// primitives here means ALL mutations are covered without touching each helper.
let READ_ONLY = false
export function setFirestoreReadOnly(v) { READ_ONLY = Boolean(v) }
export const DEMO_READONLY_MESSAGE = "You're in the read-only demo — sign up to make changes."
function assertWritable() {
  if (READ_ONLY) throw new Error(DEMO_READONLY_MESSAGE)
}
const setDoc = (...args) => { assertWritable(); return _setDoc(...args) }
const addDoc = (...args) => { assertWritable(); return _addDoc(...args) }
const updateDoc = (...args) => { assertWritable(); return _updateDoc(...args) }
const deleteDoc = (...args) => { assertWritable(); return _deleteDoc(...args) }
const writeBatch = (...args) => { assertWritable(); return _writeBatch(...args) }
import { generateQrToken } from './qr'
import { STATUS, REFILL_DEFECT_KEYS } from './constants'
import { AUDIT, diffSummary } from './audit'
import { buildExtinguisherConstraints } from './extinguisherQuery'
import { statsDeltaFor, accumulate } from './stats'

// ── Path helpers ─────────────────────────────────────────────────────────────
const orgRef = (orgId) => doc(db, 'organizations', orgId)
const extCol = (orgId) => collection(db, 'organizations', orgId, 'extinguishers')
const extRef = (orgId, id) => doc(db, 'organizations', orgId, 'extinguishers', id)
const reportCol = (orgId) => collection(db, 'organizations', orgId, 'reports')
const reportRef = (orgId, id) => doc(db, 'organizations', orgId, 'reports', id)
const userRef = (uid) => doc(db, 'users', uid)
const qrRef = (token) => doc(db, 'qr', token)
const auditCol = (orgId) => collection(db, 'organizations', orgId, 'auditLogs')
const statsRef = (orgId) => doc(db, 'organizations', orgId, 'meta', 'stats')
const signageCol = (orgId) => collection(db, 'organizations', orgId, 'signages')
const signageRef = (orgId, id) => doc(db, 'organizations', orgId, 'signages', id)
const drillCol = (orgId) => collection(db, 'organizations', orgId, 'mockDrills')
const drillRef = (orgId, id) => doc(db, 'organizations', orgId, 'mockDrills', id)
const aedCol = (orgId) => collection(db, 'organizations', orgId, 'aeds')
const aedRef = (orgId, id) => doc(db, 'organizations', orgId, 'aeds', id)
const fasCol = (orgId) => collection(db, 'organizations', orgId, 'fas')
const fasRef = (orgId, id) => doc(db, 'organizations', orgId, 'fas', id)
// Mock-drill evidence photos live in a per-drill subcollection (one doc each, ≤~700 KB)
// so the live drill list never carries the image blobs.
const drillPhotoCol = (orgId, drillId) => collection(db, 'organizations', orgId, 'mockDrills', drillId, 'photos')
// Public, minimal name→org index so signup can look up an org by name WITHOUT
// reading the (member-only) organizations collection.
const orgIndexKey = (name) => (name || '').trim().toLowerCase()
const orgIndexRef = (name) => doc(db, 'orgIndex', orgIndexKey(name))

// ── Audit log ──────────────────────────────────────────────────────────────────
// Append-only trail. Never let an audit failure break the primary write.
async function logAudit(orgId, actor, action, details = {}) {
  if (!orgId) return
  try {
    await addDoc(auditCol(orgId), {
      at: serverTimestamp(),
      actorUid: actor?.uid || null,
      actorName: actor?.name || 'Unknown',
      action,
      target: details.target || 'extinguisher',
      targetId: details.targetId || null,
      targetLabel: details.targetLabel || '',
      summary: details.summary || '',
      source: details.source || 'portal',
    })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[Fire Marshal] audit log failed:', e?.message || e)
  }
}

export function subscribeAuditLogs(orgId, cb) {
  const q = query(auditCol(orgId), orderBy('at', 'desc'), limit(200))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
}

// ── Stats counters (organizations/{orgId}/meta/stats) ────────────────────────
// Maintained atomically inside each mutation batch so the dashboard's structural
// totals are exact fleet-wide regardless of the 2,000 load cap.

// Apply a sparse delta object (from statsDeltaFor) to the stats counter doc as
// increment() field updates, flattened to dotted paths (e.g. "byStatus.active").
//
// IMPORTANT: this is fire-and-forget and NON-BLOCKING — it runs in its own write,
// AFTER the primary data batch has committed, and never throws. The dashboard
// stats are a convenience overlay; a stats write failing (e.g. rules not yet
// published for meta/stats) must never block or roll back the real extinguisher
// write. (Same philosophy as logAudit.)
async function bumpStats(orgId, delta) {
  if (!delta) return
  const fields = {}
  if (delta.total) fields.total = increment(delta.total)
  for (const bucket of ['byStatus', 'byType', 'byEntity', 'byRegion']) {
    const m = delta[bucket]
    if (!m) continue
    for (const k of Object.keys(m)) {
      if (m[k]) fields[`${bucket}.${k}`] = increment(m[k])
    }
  }
  if (Object.keys(fields).length === 0) return
  fields.updatedAt = serverTimestamp()
  try {
    // set(merge) so the doc is created on first write and increments thereafter.
    await setDoc(statsRef(orgId), fields, { merge: true })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[Fire Marshal] stats update skipped:', e?.message || e)
  }
}

export function subscribeStats(orgId, cb) {
  return onSnapshot(statsRef(orgId), (snap) => cb(snap.exists() ? snap.data() : null))
}

/** Full recompute from a one-time read of all extinguishers (admin Refresh / backfill). */
export async function recomputeStats(orgId) {
  const snap = await getDocs(extCol(orgId))
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const s = accumulate(list)
  await setDoc(statsRef(orgId), { ...s, updatedAt: serverTimestamp() })
  return s
}

const extLabelOf = (ext) =>
  ext?.serialNo ? `${ext.serialNo} · ${ext.type || ''}`.trim() : `${ext?.type || ''} · ${ext?.capacity || ''}`

// ── Organizations & users ─────────────────────────────────────────────────────

/** Create an org + its first admin user + public name index, atomically. */
export async function createOrganization({ orgName, address, uid, name, email }) {
  const org = doc(collection(db, 'organizations'))
  const batch = writeBatch(db)
  batch.set(org, {
    name: orgName,
    nameLower: orgName.trim().toLowerCase(),
    address: address || '',
    createdBy: uid,
    notificationEmail: email, // default: admin's email (editable later)
    createdAt: serverTimestamp(),
  })
  batch.set(userRef(uid), {
    name,
    email,
    orgId: org.id,
    orgName,
    role: 'admin',
    status: 'approved',
    createdAt: serverTimestamp(),
  })
  // Public lookup index (no sensitive fields) so signup can resolve org-by-name
  // without read access to the organizations collection.
  batch.set(orgIndexRef(orgName), { orgId: org.id, name: orgName })
  await batch.commit()
  return org.id
}

/**
 * Find an organization by exact (case-insensitive) name via the public
 * orgIndex. Returns { id, name } or null. (Only the fields needed at signup.)
 */
export async function findOrgByName(orgName) {
  const snap = await getDoc(orgIndexRef(orgName))
  if (!snap.exists()) return null
  const d = snap.data()
  return { id: d.orgId, name: d.name }
}

/**
 * List every organization (from the public orgIndex), as [{ id, name }] sorted
 * by name. Used by the signup dropdown so members pick a real org instead of
 * typing its name. Public-readable, so it works pre-auth.
 */
export async function listOrganizations() {
  const snap = await getDocs(collection(db, 'orgIndex'))
  return snap.docs
    .map((d) => ({ id: d.data().orgId, name: d.data().name }))
    .filter((o) => o.id && o.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Backfill the public orgIndex entry for an org if it's missing. Orgs created
 * before the orgIndex feature have no index doc, so they don't appear in the
 * signup dropdown. A signed-in member of the org self-heals it on load.
 * Idempotent + non-blocking: skips when the doc already exists, swallows errors
 * (the index is a convenience for signup, never critical to the app).
 */
export async function ensureOrgIndex(org) {
  if (!org?.id || !org?.name) return
  try {
    const ref = orgIndexRef(org.name)
    const snap = await getDoc(ref)
    if (snap.exists()) return
    await setDoc(ref, { orgId: org.id, name: org.name })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[Fire Marshal] orgIndex backfill skipped:', e?.message || e)
  }
}

/**
 * Explicit, admin-triggered version of the orgIndex backfill. Unlike
 * ensureOrgIndex this does NOT swallow errors — so the UI can show a clear
 * permission/error toast (e.g. when the live rules haven't been published).
 * Writes (creates/overwrites) the public orgIndex entry so the org appears in
 * the signup "Join your team" dropdown.
 */
export async function registerOrgInIndex(orgId, orgName) {
  if (!orgId || !orgName) throw new Error('Organization details are missing.')
  await setDoc(orgIndexRef(orgName), { orgId, name: orgName })
}

/** Create a pending member who is joining an existing org. */
export async function createPendingMember({ uid, name, email, orgId, orgName }) {
  await setDoc(userRef(uid), {
    name,
    email,
    orgId,
    orgName,
    role: 'member',
    status: 'pending',
    createdAt: serverTimestamp(),
  })
}

export async function getUserProfile(uid) {
  const snap = await getDoc(userRef(uid))
  return snap.exists() ? normalizeRoles({ uid, ...snap.data() }) : null
}

// Multi-role compatibility: ensure roles[] exists and role/isAdmin reflect it so
// existing `role === 'admin'` checks keep working when users hold several roles.
function normalizeRoles(p) {
  const roles = Array.isArray(p.roles) && p.roles.length ? p.roles : p.role ? [p.role] : []
  const isAdmin = p.isAdmin === true || roles.includes('admin')
  const role = isAdmin ? 'admin' : roles.includes(p.role) ? p.role : roles[0] || p.role || 'member'
  return { ...p, roles, isAdmin, role }
}

// Delegated to the shared ref-counted org-users listener (one per org app-wide).
export { subscribeOrgUsers } from '../../../shared/org/orgData'

/** Live org document. */
export function subscribeOrg(orgId, cb) {
  return onSnapshot(orgRef(orgId), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null))
}

/** Admin updates org-level settings. */
export async function updateOrgSettings(orgId, updates, actor) {
  await updateDoc(orgRef(orgId), updates)
  await logAudit(orgId, actor, AUDIT.ORG_SETTINGS, {
    target: 'org',
    summary: `Updated org settings: ${Object.keys(updates).join(', ')}`,
  })
}

export async function setUserStatus(uid, status, orgId, actor, userLabel) {
  await updateDoc(userRef(uid), { status })
  await logAudit(orgId, actor, AUDIT.USER_STATUS, {
    target: 'user',
    targetId: uid,
    targetLabel: userLabel || uid,
    summary: `Set status → ${status}`,
  })
}

export async function setUserRole(uid, role, orgId, actor, userLabel) {
  await updateDoc(userRef(uid), { role })
  await logAudit(orgId, actor, AUDIT.USER_ROLE, {
    target: 'user',
    targetId: uid,
    targetLabel: userLabel || uid,
    summary: `Set role → ${role}`,
  })
}

// ── QR mirror ──────────────────────────────────────────────────────────────────
// Minimal public-readable copy of an extinguisher, keyed by qrToken.
function mirrorPayload(orgId, orgName, id, ext) {
  return {
    orgId,
    orgName: orgName || '',
    extId: id,
    token: ext.qrToken,
    // Every field is defaulted: Firestore rejects `undefined`, and assets that
    // predate a column (or arrived by import) legitimately lack one. The add
    // path always supplies them, but backfilling existing stock does not.
    serialNo: ext.serialNo || '',
    type: ext.type || '',
    capacity: ext.capacity || '',
    entity: ext.entity || '',
    region: ext.region || '',
    centerName: ext.centerName || '',
    dateOfDeployment: ext.dateOfDeployment || '',
    dateOfNextRefill: ext.dateOfNextRefill || '',
    dateOfNextHPT: ext.dateOfNextHPT || '',
    status: ext.status || '',
    physicalDefects: ext.physicalDefects || [],
    updatedAt: serverTimestamp(),
  }
}

// ── Extinguishers ──────────────────────────────────────────────────────────────

/** Add a single extinguisher + its public QR mirror. Returns {id, qrToken}. */
export async function addExtinguisher(orgId, orgName, data, actor) {
  const ref = doc(extCol(orgId))
  const qrToken = generateQrToken()
  const ext = {
    serialNo: data.serialNo || '',
    type: data.type,
    capacity: data.capacity,
    entity: data.entity,
    region: data.region || '',
    centerName: data.centerName,
    dateOfDeployment: data.dateOfDeployment || '',
    dateOfNextRefill: data.dateOfNextRefill || '',
    dateOfNextHPT: data.dateOfNextHPT || '',
    status: STATUS.ACTIVE,
    physicalDefects: [],
    deletedAt: null,
    qrToken,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  const batch = writeBatch(db)
  batch.set(ref, ext)
  batch.set(qrRef(qrToken), mirrorPayload(orgId, orgName, ref.id, ext))
  await batch.commit()
  await bumpStats(orgId, statsDeltaFor(null, ext))
  await logAudit(orgId, actor, AUDIT.EXT_CREATE, {
    targetId: ref.id,
    targetLabel: extLabelOf(ext),
    summary: `${ext.type} ${ext.capacity} @ ${ext.centerName}`,
  })
  return { id: ref.id, qrToken }
}

/**
 * Give extinguishers that have no QR code one, and publish their public mirror.
 *
 * Assets that predate the QR system — imported, seeded, or created before it
 * existed — carry no token, so "Print QR" produced nothing for them and a scan
 * could never resolve. Backfills only what is missing; an existing token is
 * left alone so labels already on the wall keep working.
 *
 * Returns the number of assets given a code.
 */
export async function backfillExtinguisherQr(orgId, orgName, extinguishers, actor) {
  const missing = extinguishers.filter((e) => !e.qrToken && !e.deletedAt)
  if (!missing.length) return 0
  // Each asset is 2 writes, so chunk well inside the 500-op batch limit.
  for (let i = 0; i < missing.length; i += 200) {
    const batch = writeBatch(db)
    for (const asset of missing.slice(i, i + 200)) {
      const qrToken = generateQrToken()
      batch.update(extRef(orgId, asset.id), { qrToken, updatedAt: serverTimestamp() })
      batch.set(qrRef(qrToken), mirrorPayload(orgId, orgName, asset.id, { ...asset, qrToken }))
    }
    await batch.commit()
  }
  await logAudit(orgId, actor, AUDIT.EXT_UPDATE, {
    summary: `Generated QR codes for ${missing.length} extinguisher(s) that had none`,
  })
  return missing.length
}

/**
 * Attach extinguishers to the site registry.
 *
 * Writes the resolved siteId and takes entity from the linked site, which is
 * the system of record for what a site is. The public QR mirror carries entity
 * too, so it is rewritten in the same batch — otherwise a scanned label would
 * keep showing the old value.
 *
 * `plan` comes from planSiteLinks(); nothing here decides what matches.
 */
export async function linkExtinguishersToSites(orgId, orgName, plan, actor) {
  const items = plan.linked
  if (!items.length) return { linked: 0, entityChanges: 0 }

  // Two writes per asset, so chunk well inside the 500-op batch limit.
  for (let i = 0; i < items.length; i += 200) {
    const batch = writeBatch(db)
    for (const { ext, site } of items.slice(i, i + 200)) {
      const merged = { ...ext, siteId: site.id, siteName: site.name, entity: site.entity }
      batch.update(extRef(orgId, ext.id), {
        siteId: site.id,
        siteName: site.name,
        entity: site.entity,
        updatedAt: serverTimestamp(),
      })
      if (ext.qrToken) batch.set(qrRef(ext.qrToken), mirrorPayload(orgId, orgName, ext.id, merged))
    }
    await batch.commit()
  }

  await logAudit(orgId, actor, AUDIT.EXT_UPDATE, {
    summary: `Linked ${items.length} extinguisher(s) to sites; ${plan.entityChanges} entity value(s) corrected from the site registry`,
  })
  return { linked: items.length, entityChanges: plan.entityChanges }
}

/** Bulk add many extinguishers in chunked batches. Returns count written. */
export async function bulkAddExtinguishers(orgId, orgName, rows, actor) {
  let written = 0
  const allCreated = []
  // Firestore batches max 500 ops; each row = 2 writes, so chunk by 200 rows.
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200)
    const batch = writeBatch(db)
    const created = []
    for (const data of chunk) {
      const ref = doc(extCol(orgId))
      // Reuse a QR code the site already has printed, when the upload supplied
      // one; otherwise mint a fresh token.
      const qrToken = data.qrToken || generateQrToken()
      const ext = {
        serialNo: data.serialNo || '',
        type: data.type,
        capacity: data.capacity,
        entity: data.entity,
        region: data.region || '',
        centerName: data.centerName,
        dateOfDeployment: data.dateOfDeployment || '',
        dateOfNextRefill: data.dateOfNextRefill || '',
        dateOfNextHPT: data.dateOfNextHPT || '',
        // Migrated rows may arrive already flagged; a fresh row defaults to active.
        status: data.status || STATUS.ACTIVE,
        physicalDefects: Array.isArray(data.physicalDefects) ? data.physicalDefects : [],
        deletedAt: null,
        qrToken,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
      batch.set(ref, ext)
      batch.set(qrRef(qrToken), mirrorPayload(orgId, orgName, ref.id, ext))
      created.push(ext)
      allCreated.push(ext)
      written++
    }
    await batch.commit()
  }
  // Stats update runs AFTER all data is safely committed, and never blocks it.
  await bumpStats(orgId, accumulate(allCreated))
  await logAudit(orgId, actor, AUDIT.EXT_BULK_CREATE, {
    summary: `${written} extinguisher(s) added via bulk upload`,
  })
  return written
}

// Spec/date fields safe to overwrite on a CSV upsert (NOT status/defects/qrToken).
const UPSERT_FIELDS = [
  'type',
  'capacity',
  'entity',
  'region',
  'centerName',
  'serialNo',
  'dateOfDeployment',
  'dateOfNextRefill',
  'dateOfNextHPT',
]

/**
 * Bulk create + update from a CSV import.
 *  - creates: new extinguisher rows (each gets a fresh qrToken + mirror).
 *  - updates: [{ id, qrToken, ...data }] — overwrites spec/date fields only,
 *    preserving status, physicalDefects and the existing qrToken; mirror rewritten.
 * Returns { created, updated } counts.
 */
export async function bulkUpsertExtinguishers(orgId, orgName, { creates = [], updates = [] }, actor) {
  let created = 0
  let updated = 0

  // ── Creates (chunked: 2 writes each) ──
  for (let i = 0; i < creates.length; i += 200) {
    const chunk = creates.slice(i, i + 200)
    const batch = writeBatch(db)
    for (const data of chunk) {
      const ref = doc(extCol(orgId))
      // Reuse a QR code the site already has printed, when the upload supplied
      // one; otherwise mint a fresh token.
      const qrToken = data.qrToken || generateQrToken()
      const ext = {
        serialNo: data.serialNo || '',
        type: data.type,
        capacity: data.capacity,
        entity: data.entity,
        region: data.region || '',
        centerName: data.centerName,
        dateOfDeployment: data.dateOfDeployment || '',
        dateOfNextRefill: data.dateOfNextRefill || '',
        dateOfNextHPT: data.dateOfNextHPT || '',
        // Migrated rows may arrive already flagged; a fresh row defaults to active.
        status: data.status || STATUS.ACTIVE,
        physicalDefects: Array.isArray(data.physicalDefects) ? data.physicalDefects : [],
        deletedAt: null,
        qrToken,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
      batch.set(ref, ext)
      batch.set(qrRef(qrToken), mirrorPayload(orgId, orgName, ref.id, ext))
      created++
    }
    await batch.commit()
  }

  // ── Updates (spec/date only; keep status/defects/qrToken) ──
  for (let i = 0; i < updates.length; i += 200) {
    const chunk = updates.slice(i, i + 200)
    const batch = writeBatch(db)
    for (const row of chunk) {
      const fields = {}
      for (const k of UPSERT_FIELDS) {
        if (row[k] !== undefined) fields[k] = row[k] || ''
      }
      fields.updatedAt = serverTimestamp()
      batch.update(extRef(orgId, row.id), fields)
      if (row.qrToken) {
        // Mirror needs the full picture; carry preserved status/defects too.
        const merged = {
          ...row,
          qrToken: row.qrToken,
          status: row.status,
          physicalDefects: row.physicalDefects || [],
        }
        batch.set(qrRef(row.qrToken), mirrorPayload(orgId, orgName, row.id, merged))
      }
      updated++
    }
    await batch.commit()
  }

  // Updates can shift type/entity/region buckets (and creates add rows); a full
  // recompute is the simplest correct way to reconcile both in one pass. Stats
  // are a convenience overlay — never let a stats write block the import.
  await recomputeStats(orgId).catch((e) => console.warn('[Fire Marshal] stats recompute skipped:', e?.message || e))
  await logAudit(orgId, actor, AUDIT.EXT_BULK_UPSERT, {
    summary: `Bulk import: ${created} added, ${updated} updated`,
  })
  return { created, updated }
}

/**
 * Update an extinguisher and keep its QR mirror in sync.
 * `opts` = { actor, action, summary } drives the audit entry. Defaults to a
 * field-level diff under the generic "edit" action.
 */
export async function updateExtinguisher(orgId, orgName, id, updates, opts = {}) {
  const current = await getDoc(extRef(orgId, id))
  if (!current.exists()) throw new Error('Extinguisher not found')
  const before = current.data()
  const merged = { ...before, ...updates }
  const batch = writeBatch(db)
  batch.update(extRef(orgId, id), { ...updates, updatedAt: serverTimestamp() })
  if (merged.qrToken) {
    batch.set(qrRef(merged.qrToken), mirrorPayload(orgId, orgName, id, merged))
  }
  await batch.commit()
  await bumpStats(orgId, statsDeltaFor(before, merged))
  if (!opts.silent) {
    await logAudit(orgId, opts.actor, opts.action || AUDIT.EXT_UPDATE, {
      targetId: id,
      targetLabel: extLabelOf(merged),
      summary: opts.summary || diffSummary(before, updates),
    })
  }
}

/**
 * Soft-delete one extinguisher: mark deletedAt/deletedBy (recoverable from the
 * Recycle Bin) and remove the public QR mirror so scans stop resolving.
 */
export async function deleteExtinguisher(orgId, id, qrToken, actor, label) {
  const batch = writeBatch(db)
  batch.update(extRef(orgId, id), {
    deletedAt: serverTimestamp(),
    deletedBy: actor?.name || '',
  })
  if (qrToken) batch.delete(qrRef(qrToken))
  await batch.commit()
  await recomputeStats(orgId).catch((e) => console.warn('[Fire Marshal] stats recompute skipped:', e?.message || e))
  await logAudit(orgId, actor, AUDIT.EXT_DELETE, { targetId: id, targetLabel: label || '' })
}

/** Bulk soft-delete extinguishers (+ remove mirrors) by [{id, qrToken}]. */
export async function bulkDeleteExtinguishers(orgId, items, actor) {
  for (let i = 0; i < items.length; i += 200) {
    const chunk = items.slice(i, i + 200)
    const batch = writeBatch(db)
    for (const { id, qrToken } of chunk) {
      batch.update(extRef(orgId, id), {
        deletedAt: serverTimestamp(),
        deletedBy: actor?.name || '',
      })
      if (qrToken) batch.delete(qrRef(qrToken))
    }
    await batch.commit()
  }
  await recomputeStats(orgId).catch((e) => console.warn('[Fire Marshal] stats recompute skipped:', e?.message || e))
  await logAudit(orgId, actor, AUDIT.EXT_BULK_DELETE, {
    summary: `${items.length} extinguisher(s) deleted`,
  })
}

/** Restore a soft-deleted extinguisher: clear deletedAt + rebuild the QR mirror. */
export async function restoreExtinguisher(orgId, orgName, id, actor) {
  const snap = await getDoc(extRef(orgId, id))
  if (!snap.exists()) throw new Error('Extinguisher not found')
  const data = snap.data()
  const batch = writeBatch(db)
  batch.update(extRef(orgId, id), { deletedAt: null, deletedBy: null, updatedAt: serverTimestamp() })
  if (data.qrToken) {
    batch.set(qrRef(data.qrToken), mirrorPayload(orgId, orgName, id, { ...data, deletedAt: null }))
  }
  await batch.commit()
  // Restoring re-adds the unit to the active fleet (+1 to its buckets).
  await bumpStats(orgId, statsDeltaFor(null, { ...data, deletedAt: null }))
  await logAudit(orgId, actor, AUDIT.EXT_RESTORE, { targetId: id, targetLabel: extLabelOf(data) })
}

/** Permanently delete a soft-deleted extinguisher (admin only — enforced by rules). */
export async function purgeExtinguisher(orgId, id, qrToken, actor, label) {
  const batch = writeBatch(db)
  batch.delete(extRef(orgId, id))
  if (qrToken) batch.delete(qrRef(qrToken))
  await batch.commit()
  await logAudit(orgId, actor, AUDIT.EXT_PURGE, { targetId: id, targetLabel: label || '' })
}

// Max extinguishers loaded into the live in-memory set. The dashboard + all
// lists derive from this set client-side, so we cap it for scale; a banner warns
// when the cap is hit. (Full server-side pagination is a future enhancement.)
export const EXT_LOAD_CAP = 2000

export function subscribeExtinguishers(orgId, cb, max = EXT_LOAD_CAP) {
  const q = query(extCol(orgId), orderBy('createdAt', 'desc'), limit(max))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
}

/**
 * One-time migration: older extinguishers created before soft-delete don't have
 * a `deletedAt` field at all, so the Repository's server query
 * `where('deletedAt','==',null)` skips them (Firestore == null does NOT match a
 * missing field). Backfill `deletedAt: null` on any loaded doc missing it so it
 * becomes visible to the paginated query. Silent (no audit — it's a migration).
 * Returns the number of docs fixed. Runs only for docs where the field is
 * strictly `undefined` (absent) — never touches explicitly soft-deleted docs.
 */
export async function backfillDeletedAt(orgId, list = []) {
  const missing = list.filter((e) => e && e.id && e.deletedAt === undefined)
  if (!missing.length) return 0
  for (let i = 0; i < missing.length; i += 400) {
    const chunk = missing.slice(i, i + 400)
    const batch = writeBatch(db)
    for (const e of chunk) batch.update(extRef(orgId, e.id), { deletedAt: null })
    await batch.commit()
  }
  return missing.length
}

export const PAGE_SIZE = 50

/**
 * One page of extinguishers via cursor pagination + server-side equality
 * filters. Returns { rows, nextCursor, hasMore }.
 *  - filters: { type, capacity, entity, region, status } (use FILTER_ALL to skip)
 *  - cursor: the last QueryDocumentSnapshot from the previous page (or null)
 * Excludes soft-deleted (deletedAt == null), newest first.
 * Requires composite indexes (deletedAt + the filtered field + createdAt) —
 * Firestore will surface a one-click index link for any missing combo.
 */
export async function queryExtinguishersPage(orgId, { filters = {}, cursor = null, pageSize = PAGE_SIZE } = {}) {
  const constraints = buildExtinguisherConstraints(filters).map((c) => where(c.field, c.op, c.value))
  const parts = [...constraints, orderBy('createdAt', 'desc')]
  if (cursor) parts.push(startAfter(cursor))
  parts.push(limit(pageSize + 1)) // +1 sentinel to detect "has more"
  const snap = await getDocs(query(extCol(orgId), ...parts))
  const docs = snap.docs
  const hasMore = docs.length > pageSize
  const pageDocs = hasMore ? docs.slice(0, pageSize) : docs
  return {
    rows: pageDocs.map((d) => ({ id: d.id, ...d.data() })),
    nextCursor: pageDocs.length ? pageDocs[pageDocs.length - 1] : null,
    hasMore,
  }
}

export async function getExtinguisher(orgId, id) {
  const snap = await getDoc(extRef(orgId, id))
  return snap.exists() ? { id, ...snap.data() } : null
}

// ── Public QR ───────────────────────────────────────────────────────────────────

export async function getExtinguisherByToken(token) {
  const snap = await getDoc(qrRef(token))
  return snap.exists() ? { ...snap.data() } : null
}

// ── Reports (approval queue) ──────────────────────────────────────────────────

/**
 * Submit a report (defect or status change). Works for authenticated portal
 * users AND public QR visitors. Always lands as `pending`.
 */
export async function createReport(orgId, report) {
  await addDoc(reportCol(orgId), {
    extId: report.extId,
    extLabel: report.extLabel || '',
    kind: report.kind, // 'defect' | 'status_change'
    defectType: report.defectType || null,
    newStatus: report.newStatus || null,
    note: report.note || '',
    reportedBy: report.reportedBy || 'public',
    reportedByName: report.reportedByName || 'QR Scan (Public)',
    reporterRole: report.reporterRole || null,
    source: report.source || 'portal',
    approvalStatus: 'pending',
    reportedAt: serverTimestamp(),
  })
  const what = report.kind === 'defect' ? `defect (${report.defectType})` : `status → ${report.newStatus}`
  await logAudit(orgId, { uid: report.reportedBy, name: report.reportedByName }, AUDIT.REPORT_CREATE, {
    target: 'report',
    targetLabel: report.extLabel || report.extId,
    summary: `Reported ${what}${report.reporterRole ? ` (by ${report.reporterRole})` : ''}`,
    source: report.source || 'portal',
  })
}

export function subscribeReports(orgId, cb) {
  const q = query(reportCol(orgId), orderBy('reportedAt', 'desc'))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
}

/**
 * Approve a report and apply its effect to the extinguisher:
 *  - defect that triggers refill  → add defect + set status TO_BE_REFILLED
 *  - physical defect              → add defect (status unchanged)
 *  - status_change                → set the requested status
 */
export async function approveReport(orgId, orgName, report, reviewerName, actor) {
  const ext = await getExtinguisher(orgId, report.extId)
  if (!ext) throw new Error('Extinguisher no longer exists')

  const updates = {}
  if (report.kind === 'defect' && report.defectType) {
    const defects = new Set(ext.physicalDefects || [])
    defects.add(report.defectType)
    updates.physicalDefects = Array.from(defects)
    if (REFILL_DEFECT_KEYS.includes(report.defectType) && ext.status !== STATUS.CLOSED) {
      updates.status = STATUS.TO_BE_REFILLED
    }
  } else if (report.kind === 'status_change' && report.newStatus) {
    updates.status = report.newStatus
  }

  const reviewer = actor || { name: reviewerName }
  // Apply silently (no generic edit audit); we log the approve below.
  await updateExtinguisher(orgId, orgName, report.extId, updates, { silent: true })
  await updateDoc(reportRef(orgId, report.id), {
    approvalStatus: 'approved',
    reviewedBy: reviewerName || '',
    reviewedAt: serverTimestamp(),
  })
  const what = report.kind === 'defect' ? `defect (${report.defectType})` : `status → ${report.newStatus}`
  await logAudit(orgId, reviewer, AUDIT.REPORT_APPROVE, {
    target: 'report',
    targetId: report.extId,
    targetLabel: report.extLabel || report.extId,
    summary: `Approved ${what}`,
  })
}

export async function rejectReport(orgId, report, reviewerName, actor) {
  await updateDoc(reportRef(orgId, report.id), {
    approvalStatus: 'rejected',
    reviewedBy: reviewerName || '',
    reviewedAt: serverTimestamp(),
  })
  const what = report.kind === 'defect' ? `defect (${report.defectType})` : `status → ${report.newStatus}`
  await logAudit(orgId, actor || { name: reviewerName }, AUDIT.REPORT_REJECT, {
    target: 'report',
    targetId: report.extId,
    targetLabel: report.extLabel || report.extId,
    summary: `Rejected ${what}`,
  })
}

// ── Workflow transitions (direct, used by portal action buttons) ───────────────
// Each stamps who performed the action (lastActionBy/lastAction/lastActionAt).

function actionStamp(actorName, label) {
  return { lastActionBy: actorName || '', lastAction: label, lastActionAt: serverTimestamp() }
}

/**
 * Submit a vendor quotation for the current defect/refill cycle. Must happen
 * before an item can progress (received-by-vendor / resolve). Stored on the
 * extinguisher doc; cleared when the cycle completes.
 */
export async function submitQuotation(orgId, orgName, id, { amount, vendor, ref, notes, fileName, fileType, fileData }, actorName) {
  const quotation = {
    amount: Number(amount) || 0,
    vendor: vendor || '',
    ref: ref || '',
    notes: notes || '',
    fileName: fileName || '',
    fileType: fileType || '',
    fileData: fileData || null, // base64 data URL (≤~700KB) or null
    submittedAt: new Date().toISOString().slice(0, 10),
    submittedBy: actorName || '',
  }
  await updateExtinguisher(orgId, orgName, id, {
    quotation,
    ...actionStamp(actorName, 'Quotation submitted'),
  }, { actor: { name: actorName }, action: AUDIT.WF_QUOTATION_SUBMITTED, summary: `Quotation submitted (${quotation.amount}, ${quotation.vendor || 'vendor n/a'})` })
}

/** Vendor received the extinguisher for refilling. */
export async function markReceivedByVendor(orgId, orgName, id, actorName) {
  await updateExtinguisher(orgId, orgName, id, {
    status: STATUS.IN_PROCESS_REFILLING,
    ...actionStamp(actorName, 'Sent to vendor'),
  }, { actor: { name: actorName }, action: AUDIT.WF_SENT_TO_VENDOR, summary: 'Marked received by vendor (In Process)' })
}

/** Extinguisher refilled & returned: close it, set new due dates, clear defects. */
export async function markRefilledAndClosed(orgId, orgName, id, { dateOfNextRefill, dateOfNextHPT }, actorName) {
  await updateExtinguisher(orgId, orgName, id, {
    status: STATUS.ACTIVE,
    dateOfNextRefill,
    dateOfNextHPT,
    physicalDefects: [],
    quotation: null,
    lastRefilledAt: new Date().toISOString().slice(0, 10),
    ...actionStamp(actorName, 'Refilled & Closed'),
  }, { actor: { name: actorName }, action: AUDIT.WF_REFILLED_CLOSED, summary: `Refilled & closed (next refill ${dateOfNextRefill}, next HPT ${dateOfNextHPT})` })
}

/** Resolve (clear) physical defects without a refill. */
export async function resolveDefects(orgId, orgName, id, remainingDefects = [], actorName) {
  await updateExtinguisher(orgId, orgName, id, {
    physicalDefects: remainingDefects,
    quotation: null,
    ...actionStamp(actorName, 'Resolved defects'),
  }, { actor: { name: actorName }, action: AUDIT.WF_RESOLVED_DEFECTS, summary: 'Physical defects resolved' })
}

// ── Safety signage inventory (org-scoped, site-wise) ──────────────────────────
// A lightweight inventory of fire/safety signage per centerName (site). No QR
// mirror or stats — these are simple records read live and edited in place.

export function subscribeSignages(orgId, cb) {
  const q = query(signageCol(orgId), orderBy('createdAt', 'desc'))
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    // Missing-field/order errors shouldn't crash the app before any data exists.
    (err) => console.warn('[Fire Marshal] signage subscribe failed:', err?.message || err)
  )
}

const cleanSignage = (data) => ({
  centerName: (data.centerName || '').trim(),
  region: data.region || '',
  entity: data.entity || '',
  type: data.type || 'Other',
  floor: (data.floor || '').trim(),
  location: (data.location || '').trim(),
  condition: data.condition || 'OK',
  quantity: Number(data.quantity) || 1,
  lastChecked: data.lastChecked || '',
  notes: (data.notes || '').trim(),
  // FERP floor coverage (only meaningful for FERP Signage).
  totalFloors: Number(data.totalFloors) || 0,
  allFloors: !!data.allFloors,
  floorsCovered: Number(data.floorsCovered) || 0,
})

export async function addSignage(orgId, data, actor) {
  const ref = await addDoc(signageCol(orgId), {
    ...cleanSignage(data),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await logAudit(orgId, actor, 'signage.create', {
    target: 'signage',
    targetId: ref.id,
    targetLabel: `${data.type} @ ${data.centerName}`,
    summary: `${data.type} (${data.condition}) @ ${data.centerName}`,
  })
  return ref.id
}

export async function updateSignage(orgId, id, updates, actor) {
  await updateDoc(signageRef(orgId, id), { ...cleanSignage(updates), updatedAt: serverTimestamp() })
  await logAudit(orgId, actor, 'signage.update', {
    target: 'signage',
    targetId: id,
    targetLabel: `${updates.type} @ ${updates.centerName}`,
    summary: 'Signage updated',
  })
}

export async function deleteSignage(orgId, id, actor, label) {
  await deleteDoc(signageRef(orgId, id))
  await logAudit(orgId, actor, 'signage.delete', { target: 'signage', targetId: id, targetLabel: label || '' })
}

// ── Mock drills / emergency response records (org-scoped, site-wise) ───────────

export function subscribeMockDrills(orgId, cb) {
  const q = query(drillCol(orgId), orderBy('createdAt', 'desc'))
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => console.warn('[Fire Marshal] mock drill subscribe failed:', err?.message || err)
  )
}

/**
 * Save a mock-drill / emergency record. `data` is the full sanitized form object;
 * `data.photos` (array of base64 data URLs) is split off into a subcollection so
 * the main doc — and the live list — stay small.
 */
export async function addMockDrill(orgId, data, actor) {
  const { photos = [], ...rest } = data
  const valid = (Array.isArray(photos) ? photos : []).filter((p) => typeof p === 'string' && p.startsWith('data:'))
  // Strip undefined values — Firestore rejects them.
  const payload = JSON.parse(JSON.stringify({
    ...rest,
    photoCount: valid.length,
    loggedBy: actor?.name || '',
    createdAt: null, // placeholder; replaced by serverTimestamp below
  }))
  payload.createdAt = serverTimestamp()
  const ref = await addDoc(drillCol(orgId), payload)
  // Evidence photos, one doc each (fetched on demand when viewing / printing).
  for (const dataUrl of valid) {
    await addDoc(drillPhotoCol(orgId, ref.id), { dataUrl, createdAt: serverTimestamp() })
  }
  await logAudit(orgId, actor, 'mockdrill.create', {
    target: 'mockdrill',
    targetId: ref.id,
    targetLabel: `${data.scenario} @ ${data.centerName || '—'}`,
    summary: `${data.eventType}: ${data.scenario} (score ${data.score}%) @ ${data.centerName || '—'}`,
  })
  return ref.id
}

/** Fetch a mock drill's evidence photos on demand. Returns [{ id, dataUrl }]. */
export async function getMockDrillPhotos(orgId, drillId) {
  const snap = await getDocs(drillPhotoCol(orgId, drillId))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function deleteMockDrill(orgId, id, actor, label) {
  // Remove evidence photos first (non-fatal if it fails).
  try {
    const snap = await getDocs(drillPhotoCol(orgId, id))
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)))
  } catch (e) {
    console.warn('[Fire Marshal] drill photo cleanup skipped:', e?.message || e)
  }
  await deleteDoc(drillRef(orgId, id))
  await logAudit(orgId, actor, 'mockdrill.delete', { target: 'mockdrill', targetId: id, targetLabel: label || '' })
}

// ── AED (Automated External Defibrillator) inventory (org-scoped) ──────────────
export function subscribeAeds(orgId, cb) {
  const q = query(aedCol(orgId), orderBy('createdAt', 'desc'))
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => console.warn('[Fire Marshal] AED subscribe failed:', err?.message || err)
  )
}

const cleanAed = (d) => ({
  assetId: (d.assetId || '').trim(),
  brand: (d.brand || '').trim(),
  model: (d.model || '').trim(),
  centerName: (d.centerName || '').trim(),
  // Set when the site was resolved against the registry (bulk upload, linking
  // pass). Without it here the id would be silently dropped on write.
  siteId: d.siteId || '',
  region: d.region || '',
  entity: d.entity || '',
  location: (d.location || '').trim(),
  status: d.status || 'ready',
  installDate: d.installDate || '',
  batteryExpiry: d.batteryExpiry || '',
  padExpiry: d.padExpiry || '',
  lastInspection: d.lastInspection || '',
  nextInspection: d.nextInspection || '',
  notes: (d.notes || '').trim(),
})

// Public-readable QR mirror for an AED (keyed by qrToken, under /qr/{token}).
function aedMirror(orgId, orgName, id, a) {
  return {
    assetKind: 'aed', orgId, orgName: orgName || '', assetRefId: id, token: a.qrToken,
    label: a.assetId || 'AED', brand: a.brand || '', model: a.model || '',
    centerName: a.centerName || '', region: a.region || '', entity: a.entity || '', location: a.location || '',
    status: a.status || 'ready', batteryExpiry: a.batteryExpiry || '', padExpiry: a.padExpiry || '',
    lastInspection: a.lastInspection || '', nextInspection: a.nextInspection || '', updatedAt: serverTimestamp(),
  }
}

/**
 * Attach AEDs or FAS devices to the site registry and adopt its wording.
 *
 * Unlike the extinguisher pass, this rewrites centerName to the matched site's
 * name. Both kinds are listed, filtered and searched by that string, so leaving
 * the source system's version in place means the same building reads as two
 * different places depending on which module you are looking at.
 *
 * The original is preserved once, as sourceCenterName. If a match is ever
 * wrong, that string is the only evidence of what the asset actually arrived
 * with — and it is what the override table is keyed on, so without it a bad
 * link could not be traced back.
 *
 * `plan` comes from planSiteLinks(); nothing here decides what matches.
 */
async function linkKindToSites(orgId, orgName, plan, actor, kind) {
  const items = plan.linked
  if (!items.length) return { linked: 0, entityChanges: 0, nameChanges: 0 }

  // Two writes per asset, so chunk well inside the 500-op batch limit.
  for (let i = 0; i < items.length; i += 200) {
    const batch = writeBatch(db)
    for (const { asset, site } of items.slice(i, i + 200)) {
      const update = {
        siteId: site.id,
        siteName: site.name,
        centerName: site.name,
        entity: site.entity,
        updatedAt: serverTimestamp(),
      }
      if (!asset.sourceCenterName && asset.centerName) update.sourceCenterName = asset.centerName
      batch.update(kind.ref(orgId, asset.id), update)
      // The scanned label shows centerName and entity, so the public mirror has
      // to move in the same batch or a QR would keep showing the old site.
      if (asset.qrToken) batch.set(qrRef(asset.qrToken), kind.mirror(orgId, orgName, asset.id, { ...asset, ...update }))
    }
    await batch.commit()
  }

  await logAudit(orgId, actor, `${kind.name}.update`, {
    target: kind.name,
    summary: `Linked ${items.length} ${kind.label}(s) to sites; ${plan.nameChanges} renamed and ${plan.entityChanges} entity value(s) corrected from the site registry`,
  })
  return { linked: items.length, entityChanges: plan.entityChanges, nameChanges: plan.nameChanges }
}

export const linkAedsToSites = (orgId, orgName, plan, actor) =>
  linkKindToSites(orgId, orgName, plan, actor, { name: 'aed', label: 'AED', ref: aedRef, mirror: aedMirror })

export const linkFasToSites = (orgId, orgName, plan, actor) =>
  linkKindToSites(orgId, orgName, plan, actor, { name: 'fas', label: 'FAS device', ref: fasRef, mirror: fasMirror })

export async function addAed(orgId, orgName, data, actor) {
  // Records are created WITHOUT a QR — generating one is an admin-only action.
  const ref = doc(aedCol(orgId))
  const a = { ...cleanAed(data), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
  const batch = writeBatch(db)
  batch.set(ref, a)
  await batch.commit()
  await logAudit(orgId, actor, 'aed.create', { target: 'aed', targetId: ref.id, targetLabel: `${data.assetId || 'AED'} @ ${data.centerName}`, summary: `AED ${data.assetId || ''} added @ ${data.centerName}` })
  return { id: ref.id }
}

export async function updateAed(orgId, orgName, id, updates, actor) {
  // Never mints a QR here — only keeps an existing mirror in sync (see generateAedQr).
  const a = { ...cleanAed(updates), updatedAt: serverTimestamp() }
  const batch = writeBatch(db)
  batch.update(aedRef(orgId, id), a)
  if (updates.qrToken) batch.set(qrRef(updates.qrToken), aedMirror(orgId, orgName, id, { ...updates, ...a, qrToken: updates.qrToken }))
  await batch.commit()
  await logAudit(orgId, actor, 'aed.update', { target: 'aed', targetId: id, targetLabel: `${updates.assetId || 'AED'} @ ${updates.centerName}`, summary: 'AED updated' })
  return updates.qrToken || null
}

/** Admin-only: mint (or re-use) a QR token for an AED and write its public mirror. */
export async function generateAedQr(orgId, orgName, asset, actor) {
  const qrToken = asset.qrToken || generateQrToken()
  const batch = writeBatch(db)
  batch.update(aedRef(orgId, asset.id), { qrToken, updatedAt: serverTimestamp() })
  batch.set(qrRef(qrToken), aedMirror(orgId, orgName, asset.id, { ...asset, qrToken }))
  await batch.commit()
  await logAudit(orgId, actor, 'aed.qr_generate', { target: 'aed', targetId: asset.id, targetLabel: `${asset.assetId || 'AED'} @ ${asset.centerName}`, summary: 'QR code generated' })
  return qrToken
}

/** Log a service/inspection: stamps last inspection today, sets the next due, marks Ready. */
export async function serviceAed(orgId, orgName, asset, nextInspection, actor) {
  const today = new Date().toISOString().slice(0, 10)
  const merged = { ...asset, lastInspection: today, nextInspection: nextInspection || '', status: 'ready' }
  const a = { ...cleanAed(merged), updatedAt: serverTimestamp() }
  const batch = writeBatch(db)
  batch.update(aedRef(orgId, asset.id), a)
  if (asset.qrToken) batch.set(qrRef(asset.qrToken), aedMirror(orgId, orgName, asset.id, { ...merged, qrToken: asset.qrToken }))
  await batch.commit()
  await logAudit(orgId, actor, 'aed.service', { target: 'aed', targetId: asset.id, targetLabel: `${asset.assetId || 'AED'} @ ${asset.centerName}`, summary: `AED serviced — next inspection ${nextInspection || '—'}` })
}

export async function deleteAed(orgId, id, qrToken, actor, label) {
  const batch = writeBatch(db)
  batch.delete(aedRef(orgId, id))
  if (qrToken) batch.delete(qrRef(qrToken))
  await batch.commit()
  await logAudit(orgId, actor, 'aed.delete', { target: 'aed', targetId: id, targetLabel: label || '' })
}

/** Bulk-delete AEDs (+ remove their QR mirrors) by [{id, qrToken}]. */
export async function bulkDeleteAeds(orgId, items, actor) {
  for (let i = 0; i < items.length; i += BULK_CHUNK) {
    const batch = writeBatch(db)
    for (const { id, qrToken } of items.slice(i, i + BULK_CHUNK)) {
      batch.delete(aedRef(orgId, id))
      if (qrToken) batch.delete(qrRef(qrToken))
    }
    await batch.commit()
  }
  await logAudit(orgId, actor, 'aed.bulk_delete', { target: 'aed', summary: `${items.length} AED(s) deleted` })
}

// ── FAS (Fire Alarm System) device inventory (org-scoped) ─────────────────────
export function subscribeFas(orgId, cb) {
  const q = query(fasCol(orgId), orderBy('createdAt', 'desc'))
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => console.warn('[Fire Marshal] FAS subscribe failed:', err?.message || err)
  )
}

const cleanFas = (d) => ({
  deviceId: (d.deviceId || '').trim(),
  deviceType: d.deviceType || 'Other',
  zone: (d.zone || '').trim(),
  centerName: (d.centerName || '').trim(),
  // As with AEDs — the resolved registry link, dropped on write without this.
  siteId: d.siteId || '',
  region: d.region || '',
  entity: d.entity || '',
  location: (d.location || '').trim(),
  status: d.status || 'operational',
  installDate: d.installDate || '',
  lastService: d.lastService || '',
  nextService: d.nextService || '',
  amcVendor: (d.amcVendor || '').trim(),
  notes: (d.notes || '').trim(),
})

function fasMirror(orgId, orgName, id, a) {
  return {
    assetKind: 'fas', orgId, orgName: orgName || '', assetRefId: id, token: a.qrToken,
    label: a.deviceId || a.deviceType || 'FAS', deviceType: a.deviceType || '', zone: a.zone || '',
    centerName: a.centerName || '', region: a.region || '', entity: a.entity || '', location: a.location || '',
    status: a.status || 'operational', lastService: a.lastService || '', nextService: a.nextService || '',
    amcVendor: a.amcVendor || '', updatedAt: serverTimestamp(),
  }
}

export async function addFas(orgId, orgName, data, actor) {
  // Records are created WITHOUT a QR — generating one is an admin-only action.
  const ref = doc(fasCol(orgId))
  const a = { ...cleanFas(data), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
  const batch = writeBatch(db)
  batch.set(ref, a)
  await batch.commit()
  await logAudit(orgId, actor, 'fas.create', { target: 'fas', targetId: ref.id, targetLabel: `${data.deviceId || data.deviceType} @ ${data.centerName}`, summary: `FAS ${data.deviceType} added @ ${data.centerName}` })
  return { id: ref.id }
}

export async function updateFas(orgId, orgName, id, updates, actor) {
  // Never mints a QR here — only keeps an existing mirror in sync (see generateFasQr).
  const a = { ...cleanFas(updates), updatedAt: serverTimestamp() }
  const batch = writeBatch(db)
  batch.update(fasRef(orgId, id), a)
  if (updates.qrToken) batch.set(qrRef(updates.qrToken), fasMirror(orgId, orgName, id, { ...updates, ...a, qrToken: updates.qrToken }))
  await batch.commit()
  await logAudit(orgId, actor, 'fas.update', { target: 'fas', targetId: id, targetLabel: `${updates.deviceId || updates.deviceType} @ ${updates.centerName}`, summary: 'FAS device updated' })
  return updates.qrToken || null
}

/** Admin-only: mint (or re-use) a QR token for a FAS device and write its public mirror. */
export async function generateFasQr(orgId, orgName, asset, actor) {
  const qrToken = asset.qrToken || generateQrToken()
  const batch = writeBatch(db)
  batch.update(fasRef(orgId, asset.id), { qrToken, updatedAt: serverTimestamp() })
  batch.set(qrRef(qrToken), fasMirror(orgId, orgName, asset.id, { ...asset, qrToken }))
  await batch.commit()
  await logAudit(orgId, actor, 'fas.qr_generate', { target: 'fas', targetId: asset.id, targetLabel: `${asset.deviceId || asset.deviceType} @ ${asset.centerName}`, summary: 'QR code generated' })
  return qrToken
}

/** Log a service: stamps last service today, sets the next due, marks Operational. */
export async function serviceFas(orgId, orgName, asset, nextService, actor) {
  const today = new Date().toISOString().slice(0, 10)
  const merged = { ...asset, lastService: today, nextService: nextService || '', status: 'operational' }
  const a = { ...cleanFas(merged), updatedAt: serverTimestamp() }
  const batch = writeBatch(db)
  batch.update(fasRef(orgId, asset.id), a)
  if (asset.qrToken) batch.set(qrRef(asset.qrToken), fasMirror(orgId, orgName, asset.id, { ...merged, qrToken: asset.qrToken }))
  await batch.commit()
  await logAudit(orgId, actor, 'fas.service', { target: 'fas', targetId: asset.id, targetLabel: `${asset.deviceId || asset.deviceType} @ ${asset.centerName}`, summary: `FAS serviced — next service ${nextService || '—'}` })
}

export async function deleteFas(orgId, id, qrToken, actor, label) {
  const batch = writeBatch(db)
  batch.delete(fasRef(orgId, id))
  if (qrToken) batch.delete(qrRef(qrToken))
  await batch.commit()
  await logAudit(orgId, actor, 'fas.delete', { target: 'fas', targetId: id, targetLabel: label || '' })
}

/** Bulk-delete FAS devices (+ remove their QR mirrors) by [{id, qrToken}]. */
export async function bulkDeleteFas(orgId, items, actor) {
  for (let i = 0; i < items.length; i += BULK_CHUNK) {
    const batch = writeBatch(db)
    for (const { id, qrToken } of items.slice(i, i + BULK_CHUNK)) {
      batch.delete(fasRef(orgId, id))
      if (qrToken) batch.delete(qrRef(qrToken))
    }
    await batch.commit()
  }
  await logAudit(orgId, actor, 'fas.bulk_delete', { target: 'fas', summary: `${items.length} FAS device(s) deleted` })
}

// ── AED / FAS public defect reports (submitted from a QR scan) ─────────────────
/** Create a pending asset-defect report (public QR scan). Lands in Approvals. */
export async function createAssetReport(orgId, { assetKind, assetRefId, assetLabel, defect, token, reporterRole, note }) {
  await addDoc(reportCol(orgId), {
    kind: 'asset_defect',
    assetKind,
    assetRefId,
    assetLabel: assetLabel || '',
    defect,
    token: token || '',
    approvalStatus: 'pending',
    source: 'qr',
    reportedBy: 'public',
    reportedByName: 'QR Scan (Public)',
    // Same two fields an extinguisher report carries, because the Approvals card
    // reads them off the report regardless of kind — without them an AED or panel
    // fault arrives anonymous next to a fully attributed extinguisher one.
    reporterRole: reporterRole || null,
    note: note || '',
    reportedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  })
}

/** Approve (→ mark the asset Faulty/Out-of-service) or reject an asset-defect report. */
export async function decideAssetReport(orgId, report, approve, reviewerName, actor) {
  const isFas = report.assetKind === 'fas'
  const newStatus = isFas ? 'faulty' : 'out_of_service'
  const batch = writeBatch(db)
  batch.update(reportRef(orgId, report.id), {
    approvalStatus: approve ? 'approved' : 'rejected',
    reviewedBy: reviewerName || '',
    reviewedAt: serverTimestamp(),
  })
  if (approve && report.assetRefId) {
    batch.update((isFas ? fasRef : aedRef)(orgId, report.assetRefId), { status: newStatus, updatedAt: serverTimestamp() })
    if (report.token) batch.update(qrRef(report.token), { status: newStatus, updatedAt: serverTimestamp() })
  }
  await batch.commit()
  await logAudit(orgId, actor, `${report.assetKind}.defect_${approve ? 'approved' : 'rejected'}`, {
    target: report.assetKind, targetId: report.assetRefId || '', targetLabel: report.assetLabel || '',
    summary: `${report.defect}${approve ? ` — marked ${isFas ? 'Faulty' : 'Out of service'}` : ' — dismissed'}`,
  })
}

// ── AED / FAS bulk create (from spreadsheet upload) ───────────────────────────
// Each row writes the asset doc + its public QR mirror (2 ops); chunk under the
// 500-op Firestore batch limit.
const BULK_CHUNK = 200

export async function bulkAddAeds(orgId, orgName, rows, actor) {
  let created = 0
  for (let i = 0; i < rows.length; i += BULK_CHUNK) {
    const batch = writeBatch(db)
    for (const row of rows.slice(i, i + BULK_CHUNK)) {
      const ref = doc(aedCol(orgId))
      const qrToken = generateQrToken()
      const a = { ...cleanAed(row), qrToken, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
      batch.set(ref, a)
      batch.set(qrRef(qrToken), aedMirror(orgId, orgName, ref.id, a))
      created++
    }
    await batch.commit()
  }
  await logAudit(orgId, actor, 'aed.bulk_create', { target: 'aed', summary: `Bulk added ${created} AED(s)` })
  return { created }
}

export async function bulkAddFas(orgId, orgName, rows, actor) {
  // A QR is only minted for Control Panels — detectors, MCPs and hooters are
  // created without one (the panel's QR represents the whole system).
  let created = 0
  for (let i = 0; i < rows.length; i += BULK_CHUNK) {
    const batch = writeBatch(db)
    for (const row of rows.slice(i, i + BULK_CHUNK)) {
      const ref = doc(fasCol(orgId))
      const clean = cleanFas(row)
      if (clean.deviceType === 'Control Panel') {
        const qrToken = generateQrToken()
        const a = { ...clean, qrToken, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
        batch.set(ref, a)
        batch.set(qrRef(qrToken), fasMirror(orgId, orgName, ref.id, a))
      } else {
        batch.set(ref, { ...clean, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
      }
      created++
    }
    await batch.commit()
  }
  await logAudit(orgId, actor, 'fas.bulk_create', { target: 'fas', summary: `Bulk added ${created} FAS device(s)` })
  return { created }
}
