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
  orderBy,
  onSnapshot,
  serverTimestamp,
  writeBatch as _writeBatch,
  limit,
  increment,
} from 'firebase/firestore'
import { db } from '../../../shared/firebase'
import { isSessionEnd } from '../../../shared/sessionEnd'

// ── Read-only demo guard ─────────────────────────────────────────────────────
// When the demo account is signed in, every Firestore write is blocked
// client-side so the shared sample data stays pristine for the next visitor.
// Reads (subscribe*/get*/list*/query*) are untouched. Wrapping the write
// primitives here means ALL mutations are covered without touching each helper.
let READ_ONLY = false
export const DEMO_READONLY_MESSAGE = "You're in the read-only demo — sign up to make changes."
function assertWritable() {
  if (READ_ONLY) throw new Error(DEMO_READONLY_MESSAGE)
}
const setDoc = (...args) => { assertWritable(); return _setDoc(...args) }
const addDoc = (...args) => { assertWritable(); return _addDoc(...args) }
const updateDoc = (...args) => { assertWritable(); return _updateDoc(...args) }
const deleteDoc = (...args) => { assertWritable(); return _deleteDoc(...args) }
const writeBatch = (...args) => { assertWritable(); return _writeBatch(...args) }
import { generateQrToken, tokenFromQrValue } from './qr'
import { STATUS, REFILL_DEFECT_KEYS, DEFECT_BY_KEY } from './constants'
import { lockId, duplicateDefectMessage } from './defectLock'
import { putFile, removeFile, MAX_INLINE_BYTES, tooLargeForInline } from '../../../shared/storage'
import { reserveDocId } from '../../../shared/docId/reserve'
import { reportError } from '../../../shared/monitoring'
import { AUDIT, diffSummary } from './audit'
import { logAudit as logOrgAudit, auditCol, orgIndexRef, COLLECTION_READ_CAP } from '../../../shared/org/orgData'
import { hptUpdate, hptSummary } from './hpt'
import { statsDeltaFor, accumulate } from './stats'
// Mock drills name the incident commander, the people alerted, and what the
// debrief said about them. Sealed under the GENERAL class — every approved
// member may read a drill record. What stays readable is what the scorecard and
// the KPI roll-ups group by: score, outcome, eventType, scenario, the timings.
import { sealDoc, openDocs, openSnapshots } from '../../../shared/crypto'
import { resolveSealedFiles } from '../../../shared/storage/resolveFiles'

/** Policy keys for the drill collections. See src/shared/crypto/policy.js. */
const SEALED_DRILLS = 'mockDrills'
const SEALED_DRILL_PHOTOS = 'mockDrills/photos'

// ── Path helpers ─────────────────────────────────────────────────────────────
const orgRef = (orgId) => doc(db, 'organizations', orgId)
const extCol = (orgId) => collection(db, 'organizations', orgId, 'extinguishers')
const extRef = (orgId, id) => doc(db, 'organizations', orgId, 'extinguishers', id)
const reportCol = (orgId) => collection(db, 'organizations', orgId, 'reports')
const reportRef = (orgId, id) => doc(db, 'organizations', orgId, 'reports', id)
const defectLockRef = (orgId, extId, defectType) =>
  doc(db, 'organizations', orgId, 'defectLocks', lockId(extId, defectType))
const qrRef = (token) => doc(db, 'qr', token)
const statsRef = (orgId) => doc(db, 'organizations', orgId, 'meta', 'stats')
const signageCol = (orgId) => collection(db, 'organizations', orgId, 'signages')
const signageRef = (orgId, id) => doc(db, 'organizations', orgId, 'signages', id)
const drillCol = (orgId) => collection(db, 'organizations', orgId, 'mockDrills')
const drillRef = (orgId, id) => doc(db, 'organizations', orgId, 'mockDrills', id)
const aedCol = (orgId) => collection(db, 'organizations', orgId, 'aeds')
const aedRef = (orgId, id) => doc(db, 'organizations', orgId, 'aeds', id)
const fasCol = (orgId) => collection(db, 'organizations', orgId, 'fas')
const fasRef = (orgId, id) => doc(db, 'organizations', orgId, 'fas', id)
const firstAidCol = (orgId) => collection(db, 'organizations', orgId, 'firstAid')
const firstAidRef = (orgId, id) => doc(db, 'organizations', orgId, 'firstAid', id)
const stretcherCol = (orgId) => collection(db, 'organizations', orgId, 'stretchers')
const stretcherRef = (orgId, id) => doc(db, 'organizations', orgId, 'stretchers', id)
// Mock-drill evidence photos live in a per-drill subcollection (one doc each, ≤~700 KB)
// so the live drill list never carries the image blobs.
const drillPhotoCol = (orgId, drillId) => collection(db, 'organizations', orgId, 'mockDrills', drillId, 'photos')

// ── Audit log ──────────────────────────────────────────────────────────────────
// The trail is written by ONE implementation, in shared/org/orgData. This
// wrapper adds only what is specific to this module.
//
// The private copy it replaces omitted `module`, and Admin → Audit Log renders
// MODULE_BY_KEY[l.module] — so every entry the fleet wrote displayed as "Core",
// and the log could not be filtered back to the module that produced it. Drill
// writes pass module: 'drills' at the call site; this file serves both keys.
const logAudit = (orgId, actor, action, details = {}) =>
  logOrgAudit(orgId, actor, action, { module: 'equipment', target: 'extinguisher', ...details })

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

// Delegated to the shared ref-counted org-users listener (one per org app-wide).
export { subscribeOrgUsers } from '../../../shared/org/orgData'

/** Live org document. */
export function subscribeOrg(orgId, cb) {
  return onSnapshot(orgRef(orgId), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null))
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
  // Adopt a code the site has already printed, exactly as the CSV import does.
  // The add form offers a QR Link field for the same reason imports accept one:
  // stock frequently arrives with labels already stuck on, and minting a fresh
  // token here would mean every one of those labels scans to nothing.
  const qrToken = tokenFromQrValue(data.qrToken || data.qrLink) || generateQrToken()
  const ext = {
    serialNo: data.serialNo || '',
    type: data.type,
    capacity: data.capacity,
    entity: data.entity,
    region: data.region || '',
    centerName: data.centerName,
    // The form carries these and SiteScopePicker fills them, but this object
    // literal used to drop them, so every unit added here was created unlinked
    // and the backlog grew faster than any repair pass could clear it. AEDs and
    // FAS already carry the same line, with the same comment, for the same
    // reason -- see cleanAed and cleanFas below.
    siteId: data.siteId || '',
    siteName: data.site || data.centerName || '',
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
      // A site record is not obliged to carry a name or an entity, and Firestore
      // rejects an undefined field value outright — so one registry row with a
      // blank entity threw before the first batch committed and took the whole
      // link action down with a message about "invalid data", naming a document
      // id and nothing a reader could act on. Coerce, and a blank stays blank.
      const siteName = site.name || ''
      const entity = site.entity || ''
      const merged = { ...ext, siteId: site.id, siteName, entity }
      batch.update(extRef(orgId, ext.id), {
        siteId: site.id,
        siteName,
        entity,
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

// Spec/date fields safe to overwrite on a CSV upsert (NOT status/defects/qrToken).
const UPSERT_FIELDS = [
  'type',
  'capacity',
  'entity',
  'region',
  'centerName',
  // Carried on an upsert too, so re-importing an export does not strip a link
  // a repair pass just established.
  'siteId',
  'siteName',
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
        // Same omission as addExtinguisher had: a CSV can carry a resolved site,
        // and dropping it here is why a bulk upload of hundreds of units left
        // every one of them unlinked.
        siteId: data.siteId || '',
        siteName: data.site || data.centerName || '',
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

// Max records loaded into the live in-memory set. The dashboard and all lists
// derive from these sets client-side, so they are capped for scale.
//
// This used to be a private 2000 while reports and mock drills capped at 1000
// and signage, AEDs and FAS at 2000 — five different silent ceilings, only ONE
// of which (extinguishers) ever told anyone it had been reached. An org past
// 1000 drills saw a dashboard built on the most recent 1000 and no indication
// of it. They are now all COLLECTION_READ_CAP, the same ceiling the rest of the
// app uses, and FleetContext reports every one of them through the shared
// incompleteReadNotice.
export const EXT_LOAD_CAP = COLLECTION_READ_CAP

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

export async function getExtinguisher(orgId, id) {
  const snap = await getDoc(extRef(orgId, id))
  return snap.exists() ? { id, ...snap.data() } : null
}

// ── Public QR ───────────────────────────────────────────────────────────────────

// ── Reports (approval queue) ──────────────────────────────────────────────────

/**
 * Submit a report (defect or status change). Works for authenticated portal
 * users AND public QR visitors. Always lands as `pending`.
 */
export async function createReport(orgId, report) {
  // One open report per defect per unit. The lock document and the report are
  // written together, so a duplicate cannot slip through between the check and
  // the write, and the QR page — which may not read reports — is covered by the
  // same rule as the portal.
  if (report.kind === 'defect' && report.defectType) {
    const batch = writeBatch(db)
    batch.set(defectLockRef(orgId, report.extId, report.defectType), {
      extId: report.extId,
      defectType: report.defectType,
      createdAt: serverTimestamp(),
      // The scanned token. A public reporter has no account, so this is the only
      // evidence they were ever near the unit — the rules require it to name
      // this exact extinguisher, which is what stops a stranger pre-creating
      // locks and silently suppressing everyone else's defect reports.
      token: report.token || '',
    })
    batch.set(doc(reportCol(orgId)), reportPayload(report))
    try {
      await batch.commit()
    } catch (e) {
      if (e?.code !== 'permission-denied') throw e

      // Somebody just failed to report a safety defect. Whatever the cause,
      // that must reach an operator — this exact failure once looked like a
      // duplicate for a day because the only signal was a hedged sentence on a
      // phone in a corridor, and nothing anywhere else.
      reportError(e, {
        where: 'createReport',
        extId: report.extId,
        defectType: report.defectType,
        source: report.source,
        hasToken: Boolean(report.token),
      })

      // A duplicate is only the LIKELIEST cause. When the caller can read the
      // lock collection we can stop guessing and say which it actually was; a
      // public reporter cannot, and gets the hedged message that assumes the
      // common case without asserting it.
      const label = DEFECT_BY_KEY[report.defectType]?.label || 'That defect'
      let locked = null
      try {
        locked = (await getDoc(defectLockRef(orgId, report.extId, report.defectType))).exists()
      } catch {
        locked = null // not permitted to look — anonymous scan
      }

      if (locked === false) {
        // Certain it is not a duplicate, so saying so would be a lie. Whatever
        // refused this is a fault on our side, and the reporter needs to know
        // the defect is NOT recorded.
        throw new Error(
          `${label} could not be reported — the system refused it, and it has NOT been logged. ` +
          `Tell your safety team directly. This has been reported to the administrators.`
        )
      }
      throw new Error(duplicateDefectMessage(label))
    }
    await logReportCreated(orgId, report)
    return
  }

  await addDoc(reportCol(orgId), reportPayload(report))
  await logReportCreated(orgId, report)
}

function reportPayload(report) {
  return {
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
    // Proof of scan. The rules require a public report to carry the token of
    // the very asset it names, so orgId and extId stop being strings an
    // anonymous writer can invent. Members are authorised without it, but it
    // costs nothing to send and keeps both paths identical.
    token: report.token || '',
  }
}

function logReportCreated(orgId, report) {
  const what = report.kind === 'defect' ? `defect (${report.defectType})` : `status → ${report.newStatus}`
  return logAudit(orgId, { uid: report.reportedBy, name: report.reportedByName }, AUDIT.REPORT_CREATE, {
    target: 'report',
    targetLabel: report.extLabel || report.extId,
    summary: `Reported ${what}${report.reporterRole ? ` (by ${report.reporterRole})` : ''}`,
    source: report.source || 'portal',
  })
}

export function subscribeReports(orgId, cb) {
  const q = query(reportCol(orgId), orderBy('reportedAt', 'desc'), limit(COLLECTION_READ_CAP))
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

/**
 * Release the lock on defects that are no longer live for a unit, so the same
 * fault can be reported again the next time it happens.
 *
 * Deleting a lock that is not there is not an error, and a failure here must
 * not fail the close it follows: the worst case is a stale lock that blocks one
 * re-report, which is far better than a refill that half-applied.
 */
export async function releaseDefectLocks(orgId, extId, defectTypes = []) {
  if (!extId || defectTypes.length === 0) return
  try {
    const batch = writeBatch(db)
    for (const key of defectTypes) batch.delete(defectLockRef(orgId, extId, key))
    await batch.commit()
  } catch { /* a stale lock is recoverable; a failed close is not */ }
}

export async function rejectReport(orgId, report, reviewerName, actor) {
  await updateDoc(reportRef(orgId, report.id), {
    approvalStatus: 'rejected',
    reviewedBy: reviewerName || '',
    reviewedAt: serverTimestamp(),
  })
  // Rejected means it was never a real defect, so it becomes reportable again.
  if (report.kind === 'defect' && report.defectType) {
    await releaseDefectLocks(orgId, report.extId, [report.defectType])
  }
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
  // Resubmitting replaces the previous quotation; its cloud file would be
  // orphaned with nothing left remembering the path.
  const prev = await getExtinguisher(orgId, id)
  if (prev?.quotation?.filePath) removeFile(prev.quotation.filePath)

  // The document itself goes to cloud storage when available; the extinguisher
  // doc then carries a URL instead of the base64 payload.
  const up = fileData ? await putFile(orgId, 'quotations', fileData, fileName) : null
  // Base64 length * 3/4 is the decoded size, close enough to compare a limit.
  const inlineBytes = fileData ? Math.floor((String(fileData).split(',')[1] || '').length * 0.75) : 0
  if (!up && fileData && inlineBytes > MAX_INLINE_BYTES) {
    throw new Error(tooLargeForInline(fileName))
  }
  const quotation = {
    amount: Number(amount) || 0,
    vendor: vendor || '',
    ref: ref || '',
    notes: notes || '',
    fileName: fileName || '',
    fileType: fileType || '',
    fileData: up ? null : fileData || null, // legacy inline fallback (≤~700KB)
    fileUrl: up?.url || null,
    filePath: up?.path || null,
    submittedAt: new Date().toISOString().slice(0, 10),
    submittedBy: actorName || '',
  }
  await updateExtinguisher(orgId, orgName, id, {
    quotation,
    ...actionStamp(actorName, 'Quotation submitted'),
  }, { actor: { name: actorName }, action: AUDIT.WF_QUOTATION_SUBMITTED, summary: `Quotation submitted (${quotation.amount}, ${quotation.vendor || 'vendor n/a'})` })
}

/**
 * Record a hydrostatic pressure test against a cylinder that was due one.
 *
 * The counterpart of submitQuotation, and deliberately not the same thing: a
 * quotation is a step towards buying work, an HPT IS the work, and it is the
 * event that clears the unit. So this writes the certificate and, on a pass,
 * moves dateOfNextHPT — which is what takes the unit off the To Be Refilled
 * list. On a FAILURE the date is left exactly where it is (see hptUpdate): a
 * failed test condemns the cylinder, and advancing the date would make a
 * condemned unit read as compliant for another cycle.
 */
export async function submitHpt(orgId, orgName, id, { testedOn, result, nextDueOn, vendor, ref, notes, fileName, fileType, fileData }, actorName) {
  // Re-recording replaces the previous certificate; its cloud file would be
  // orphaned with nothing left remembering the path.
  const prev = await getExtinguisher(orgId, id)
  if (prev?.hpt?.filePath) removeFile(prev.hpt.filePath)

  const up = fileData ? await putFile(orgId, 'hpt-certificates', fileData, fileName) : null
  const inlineBytes = fileData ? Math.floor((String(fileData).split(',')[1] || '').length * 0.75) : 0
  if (!up && fileData && inlineBytes > MAX_INLINE_BYTES) {
    throw new Error(tooLargeForInline(fileName))
  }

  const hpt = {
    testedOn: testedOn || '',
    result: result || '',
    nextDueOn: nextDueOn || '',
    vendor: vendor || '',
    ref: ref || '',
    notes: notes || '',
    fileName: fileName || '',
    fileType: fileType || '',
    fileData: up ? null : fileData || null,
    fileUrl: up?.url || null,
    filePath: up?.path || null,
    submittedAt: new Date().toISOString().slice(0, 10),
    submittedBy: actorName || '',
  }

  const summary = hptSummary({ testedOn, result, vendor })
  await updateExtinguisher(orgId, orgName, id, {
    hpt,
    ...hptUpdate({ testedOn, result, nextDueOn }),
    ...actionStamp(actorName, summary),
  }, { actor: { name: actorName }, action: AUDIT.WF_HPT_SUBMITTED, summary })
  return hpt
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
  const before = await getExtinguisher(orgId, id)
  await updateExtinguisher(orgId, orgName, id, {
    status: STATUS.ACTIVE,
    dateOfNextRefill,
    dateOfNextHPT,
    physicalDefects: [],
    quotation: null,
    lastRefilledAt: new Date().toISOString().slice(0, 10),
    ...actionStamp(actorName, 'Refilled & Closed'),
  }, { actor: { name: actorName }, action: AUDIT.WF_REFILLED_CLOSED, summary: `Refilled & closed (next refill ${dateOfNextRefill}, next HPT ${dateOfNextHPT})` })
  // A refill clears every defect, so every one of them becomes reportable again.
  await releaseDefectLocks(orgId, id, before?.physicalDefects || [])
  // The cleared quotation's cloud file goes with it.
  if (before?.quotation?.filePath) removeFile(before.quotation.filePath)
}

/** Resolve (clear) physical defects without a refill. */
export async function resolveDefects(orgId, orgName, id, remainingDefects = [], actorName) {
  const before = await getExtinguisher(orgId, id)
  await updateExtinguisher(orgId, orgName, id, {
    physicalDefects: remainingDefects,
    quotation: null,
    ...actionStamp(actorName, 'Resolved defects'),
  }, { actor: { name: actorName }, action: AUDIT.WF_RESOLVED_DEFECTS, summary: 'Physical defects resolved' })
  // Only the ones actually cleared — a defect left on the unit stays locked.
  const kept = new Set(remainingDefects)
  await releaseDefectLocks(orgId, id, (before?.physicalDefects || []).filter((k) => !kept.has(k)))
  if (before?.quotation?.filePath) removeFile(before.quotation.filePath)
}

// ── Safety signage inventory (org-scoped, site-wise) ──────────────────────────
// A lightweight inventory of fire/safety signage per centerName (site). No QR
// mirror or stats — these are simple records read live and edited in place.

export function subscribeSignages(orgId, cb) {
  const q = query(signageCol(orgId), orderBy('createdAt', 'desc'), limit(COLLECTION_READ_CAP))
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    // Missing-field/order errors shouldn't crash the app before any data exists.
    (err) => { if (!isSessionEnd('signage', err)) console.warn('[Fire Marshal] signage subscribe failed:', err?.message || err) }
  )
}

const cleanSignage = (data) => ({
  centerName: (data.centerName || '').trim(),
  // The edit form has carried a SiteScopePicker all along, and this dropped the
  // siteId it produced — so picking a site on a signage looked like it worked
  // and stored nothing, leaving the record findable only by its typed name.
  siteId: data.siteId || '',
  siteName: data.siteName || data.site || '',
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

// ── First aid box contents (org-scoped, site-wise) ────────────────────────────
// One document per (site, box, item): what the box is meant to hold, how much
// of it is actually there, and when it goes out of date. Like signage and
// unlike an AED these are inventory records rather than scannable assets — no
// QR mirror and no stats counter, read live and edited in place.

export function subscribeFirstAid(orgId, cb) {
  const q = query(firstAidCol(orgId), orderBy('createdAt', 'desc'), limit(COLLECTION_READ_CAP))
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => { if (!isSessionEnd('first aid', err)) console.warn('[Fire Marshal] first aid subscribe failed:', err?.message || err) }
  )
}

const cleanFirstAid = (data) => ({
  centerName: (data.centerName || '').trim(),
  // The resolved site-registry link. Signage dropped this field for months and
  // its site picker looked like it worked while storing nothing; the same
  // picker is on this form, so the same field has to be written here.
  siteId: data.siteId || '',
  siteName: data.siteName || data.site || '',
  region: data.region || '',
  entity: data.entity || '',
  item: data.item || '',
  // Which box at the site this row counts. Free text, because a site's boxes
  // are known by where they are ("Reception", "Gym floor") rather than by any
  // number printed on them.
  boxLocation: (data.boxLocation || '').trim(),
  // Zero is a real answer here — "we opened the box and there were none" — so
  // this defaults to 0 rather than signage's 1. A blank that silently became
  // one would turn an empty shelf into stock.
  quantity: Number(data.quantity) || 0,
  condition: data.condition || 'Available',
  expiryDate: data.expiryDate || '',
  lastChecked: data.lastChecked || '',
  notes: (data.notes || '').trim(),
})

export async function addFirstAid(orgId, data, actor) {
  const ref = await addDoc(firstAidCol(orgId), {
    ...cleanFirstAid(data),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await logAudit(orgId, actor, 'firstaid.create', {
    target: 'firstaid',
    targetId: ref.id,
    targetLabel: `${data.item} @ ${data.centerName}`,
    summary: `${data.item} × ${data.quantity ?? 0} (${data.condition}) @ ${data.centerName}`,
  })
  return ref.id
}

export async function updateFirstAid(orgId, id, updates, actor) {
  await updateDoc(firstAidRef(orgId, id), { ...cleanFirstAid(updates), updatedAt: serverTimestamp() })
  await logAudit(orgId, actor, 'firstaid.update', {
    target: 'firstaid',
    targetId: id,
    targetLabel: `${updates.item} @ ${updates.centerName}`,
    summary: 'First aid item updated',
  })
}

export async function deleteFirstAid(orgId, id, actor, label) {
  await deleteDoc(firstAidRef(orgId, id))
  await logAudit(orgId, actor, 'firstaid.delete', { target: 'firstaid', targetId: id, targetLabel: label || '' })
}

/**
 * Write one whole box in a single pass.
 *
 * The contents checklist is sixteen rows on one screen, and saving it a row at
 * a time would be sixteen writes, sixteen audit entries and a half-saved box if
 * the fifth of them failed. `rows` are creates (no id) and updates (with one);
 * `removals` are the ids of items the checker unticked.
 */
export async function saveFirstAidBox(orgId, rows, removals, actor, label) {
  const writes = [
    ...rows.map((row) => ({ kind: row.id ? 'update' : 'create', row })),
    ...removals.map((id) => ({ kind: 'delete', id })),
  ]
  for (let i = 0; i < writes.length; i += BULK_CHUNK) {
    const batch = writeBatch(db)
    for (const w of writes.slice(i, i + BULK_CHUNK)) {
      if (w.kind === 'delete') { batch.delete(firstAidRef(orgId, w.id)); continue }
      const data = cleanFirstAid(w.row)
      if (w.kind === 'update') batch.update(firstAidRef(orgId, w.row.id), { ...data, updatedAt: serverTimestamp() })
      else batch.set(doc(firstAidCol(orgId)), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    }
    await batch.commit()
  }
  await logAudit(orgId, actor, 'firstaid.update', {
    target: 'firstaid',
    targetLabel: label || '',
    summary: `First aid box checked — ${rows.length} item(s) recorded${removals.length ? `, ${removals.length} removed` : ''}`,
  })
  return { written: rows.length, removed: removals.length }
}

// ── Mock drills / emergency response records (org-scoped, site-wise) ───────────

export function subscribeMockDrills(orgId, cb) {
  const q = query(drillCol(orgId), orderBy('createdAt', 'desc'), limit(COLLECTION_READ_CAP))
  const opened = openSnapshots(orgId, SEALED_DRILLS, cb)
  return onSnapshot(
    q,
    (snap) => opened(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => { if (!isSessionEnd('mock drills', err)) console.warn('[Fire Marshal] mock drill subscribe failed:', err?.message || err) }
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
  payload.docId = await reserveDocId(orgId, 'drills')
  // Sealed AFTER the JSON round-trip above, not before: that round-trip exists
  // to strip undefined values, and JSON.parse(JSON.stringify(...)) on sealed
  // data would be harmless but the ORDER matters the other way round — a
  // payload sealed first and then passed through JSON would still be sealed,
  // while an unsealed `undefined` reaching Firestore is a rejected write.
  const ref = await addDoc(drillCol(orgId), await sealDoc(orgId, SEALED_DRILLS, payload))
  // Evidence photos, one doc each (fetched on demand when viewing / printing).
  // Cloud storage first — the photo doc then holds a URL instead of ~700KB of
  // base64 — falling back to the inline form when the bucket is unavailable.
  for (const dataUrl of valid) {
    const up = await putFile(orgId, 'drill-evidence', dataUrl, 'evidence.jpg', { collection: SEALED_DRILL_PHOTOS })
    // Only the INLINE copy is sealed. The bucket object is not — the recorder,
    // the detail modal and the printed report all render `.dataUrl` (normalised
    // from `.url` by getMockDrillPhotos) straight into an <img>, so sealing the
    // object would show a broken picture everywhere with nothing to explain it.
    // Written up above the table in src/shared/crypto/policy.js.
    await addDoc(drillPhotoCol(orgId, ref.id), up
      ? {
        url: up.url,
        path: up.path,
        createdAt: serverTimestamp(),
        ...(up.encIv ? { encScheme: up.encScheme, encKeyId: up.encKeyId, encIv: up.encIv, ...(up.encWrapped ? { encWrapped: up.encWrapped } : {}) } : {}),
      }
      : await sealDoc(orgId, SEALED_DRILL_PHOTOS, { dataUrl, createdAt: serverTimestamp() }))
  }
  await logAudit(orgId, actor, 'mockdrill.create', {
    module: 'drills',
    target: 'mockdrill',
    targetId: ref.id,
    targetLabel: `${data.scenario} @ ${data.centerName || '—'}`,
    summary: `${data.eventType}: ${data.scenario} (score ${data.score}%) @ ${data.centerName || '—'}`,
  })
  return ref.id
}

/**
 * Fetch a mock drill's evidence photos on demand. Returns [{ id, dataUrl }] —
 * the seam normalises cloud photos onto the same field, so every renderer and
 * the PDF keep reading `.dataUrl` whichever era the photo was saved in.
 */
export async function getMockDrillPhotos(orgId, drillId) {
  const snap = await getDocs(drillPhotoCol(orgId, drillId))
  // Opened BEFORE the `.dataUrl || .url` normalisation: an inline photo's
  // dataUrl is sealed, and the fallback run first would see an envelope, find
  // it truthy, and hand every renderer a base64 string in place of an image.
  const rows = await openDocs(orgId, SEALED_DRILL_PHOTOS, snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  const normalised = rows.map((r) => ({ ...r, id: r.id, path: r.path || '', dataUrl: r.dataUrl || r.url || '' }))
  // A sealed object becomes a blob: URL, which pins its bytes until revoked.
  // Unlike the subscriptions, this is a one-shot read with no unsubscribe to
  // hang the cleanup on — so the revoke comes back with the rows and the caller
  // holds it. `revoke` is a no-op when nothing was encrypted, which is every
  // drill recorded before sealing was switched on.
  const { rows: resolved, revoke } = await resolveSealedFiles(orgId, SEALED_DRILL_PHOTOS, normalised)
  resolved.revoke = revoke
  return resolved
}

export async function deleteMockDrill(orgId, id, actor, label) {
  // Remove evidence photos first (non-fatal if it fails). Cloud copies go too —
  // a photo doc is the only thing that remembers its storage path.
  try {
    const snap = await getDocs(drillPhotoCol(orgId, id))
    for (const d of snap.docs) {
      if (d.data().path) removeFile(d.data().path)
    }
    // One write each, so chunk well inside the 500-op batch limit. A drill with
    // a hundred evidence photos used to fire a hundred separate deletes.
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = writeBatch(db)
      for (const d of snap.docs.slice(i, i + 400)) batch.delete(d.ref)
      await batch.commit()
    }
  } catch (e) {
    console.warn('[Fire Marshal] drill photo cleanup skipped:', e?.message || e)
  }
  await deleteDoc(drillRef(orgId, id))
  await logAudit(orgId, actor, 'mockdrill.delete', { module: 'drills', target: 'mockdrill', targetId: id, targetLabel: label || '' })
}

// ── AED (Automated External Defibrillator) inventory (org-scoped) ──────────────
export function subscribeAeds(orgId, cb) {
  const q = query(aedCol(orgId), orderBy('createdAt', 'desc'), limit(COLLECTION_READ_CAP))
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => { if (!isSessionEnd('AEDs', err)) console.warn('[Fire Marshal] AED subscribe failed:', err?.message || err) }
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
      // Same coercion as the extinguisher pass: a registry row is not obliged
      // to carry a name or an entity, and Firestore rejects undefined outright,
      // so one blank field failed the whole batch rather than that one asset.
      const siteName = site.name || ''
      const update = {
        siteId: site.id,
        siteName,
        centerName: siteName,
        entity: site.entity || '',
        updatedAt: serverTimestamp(),
      }
      if (!asset.sourceCenterName && asset.centerName) update.sourceCenterName = asset.centerName
      batch.update(kind.ref(orgId, asset.id), update)
      // Signage has no public QR page, so a kind may have no mirror at all.
      // The scanned label shows centerName and entity, so the public mirror has
      // to move in the same batch or a QR would keep showing the old site.
      if (asset.qrToken && kind.mirror) batch.set(qrRef(asset.qrToken), kind.mirror(orgId, orgName, asset.id, { ...asset, ...update }))
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

// No mirror: signage is an inventory record, not a scannable asset.
export const linkSignagesToSites = (orgId, orgName, plan, actor) =>
  linkKindToSites(orgId, orgName, plan, actor, { name: 'signage', label: 'signage', ref: signageRef })

export const linkStretchersToSites = (orgId, orgName, plan, actor) =>
  linkKindToSites(orgId, orgName, plan, actor, { name: 'stretcher', label: 'stretcher', ref: stretcherRef, mirror: stretcherMirror })

// No mirror, for the same reason as signage: a first aid row counts what is in
// a box, and nothing scans it.
export const linkFirstAidToSites = (orgId, orgName, plan, actor) =>
  linkKindToSites(orgId, orgName, plan, actor, { name: 'firstaid', label: 'first aid record', ref: firstAidRef })

/**
 * Link every register in one action, from the plans planAllSiteLinks produced.
 *
 * Each kind still writes through its own function, because the writes differ —
 * this only saves the reader running the same errand in three places. A kind
 * with nothing to do is skipped rather than called with an empty plan, so its
 * audit entry is not written either.
 *
 * Failures are per kind and reported, not swallowed: linking the AEDs is a real
 * outcome worth keeping even if the fire-alarm pass then fails, and a caller
 * that saw one error for the whole action could not tell you which of the three
 * actually landed.
 */
export async function linkAllEquipmentToSites(orgId, orgName, byKind, actor) {
  const runners = [
    ['ext', linkExtinguishersToSites],
    ['aed', linkAedsToSites],
    ['fas', linkFasToSites],
    ['sign', linkSignagesToSites],
    ['stretcher', linkStretchersToSites],
    ['firstAid', linkFirstAidToSites],
  ]
  const totals = { linked: 0, entityChanges: 0, nameChanges: 0 }
  const failed = []
  for (const [key, run] of runners) {
    const plan = byKind?.[key]
    if (!plan?.linked?.length) continue
    try {
      const r = await run(orgId, orgName, plan, actor)
      totals.linked += r.linked || 0
      totals.entityChanges += r.entityChanges || 0
      totals.nameChanges += r.nameChanges || 0
    } catch (e) {
      failed.push({ kind: key, message: e?.message || String(e) })
    }
  }
  return { ...totals, failed }
}

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

// ── Stretchers (org-scoped) ───────────────────────────────────────────────────
// Deliberately the AED's shape rather than signage's: a stretcher is one
// physical unit in one place, and the question asked of it — is THIS stretcher
// usable — is answered by a person standing in front of it. Hence the QR, the
// public defect sheet and the inspection cycle, none of which a signage-style
// site × type matrix could carry.
export function subscribeStretchers(orgId, cb) {
  const q = query(stretcherCol(orgId), orderBy('createdAt', 'desc'), limit(COLLECTION_READ_CAP))
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => { if (!isSessionEnd('stretchers', err)) console.warn('[Fire Marshal] stretcher subscribe failed:', err?.message || err) }
  )
}

const cleanStretcher = (d) => ({
  assetId: (d.assetId || '').trim(),
  type: d.type || 'Foldable',
  brand: (d.brand || '').trim(),
  model: (d.model || '').trim(),
  centerName: (d.centerName || '').trim(),
  // As with AEDs — the resolved registry link, dropped on write without this.
  siteId: d.siteId || '',
  region: d.region || '',
  entity: d.entity || '',
  location: (d.location || '').trim(),
  status: d.status || 'ready',
  installDate: d.installDate || '',
  lastInspection: d.lastInspection || '',
  nextInspection: d.nextInspection || '',
  notes: (d.notes || '').trim(),
})

// Public-readable QR mirror for a stretcher (keyed by qrToken, under /qr/{token}).
function stretcherMirror(orgId, orgName, id, a) {
  return {
    assetKind: 'stretcher', orgId, orgName: orgName || '', assetRefId: id, token: a.qrToken,
    label: a.assetId || 'Stretcher', stretcherType: a.type || '', brand: a.brand || '', model: a.model || '',
    centerName: a.centerName || '', region: a.region || '', entity: a.entity || '', location: a.location || '',
    status: a.status || 'ready',
    lastInspection: a.lastInspection || '', nextInspection: a.nextInspection || '', updatedAt: serverTimestamp(),
  }
}

export async function addStretcher(orgId, orgName, data, actor) {
  // Records are created WITHOUT a QR — generating one is an admin-only action.
  const ref = doc(stretcherCol(orgId))
  const a = { ...cleanStretcher(data), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
  const batch = writeBatch(db)
  batch.set(ref, a)
  await batch.commit()
  await logAudit(orgId, actor, 'stretcher.create', { target: 'stretcher', targetId: ref.id, targetLabel: `${data.assetId || 'Stretcher'} @ ${data.centerName}`, summary: `Stretcher ${data.assetId || ''} added @ ${data.centerName}` })
  return { id: ref.id }
}

export async function updateStretcher(orgId, orgName, id, updates, actor) {
  // Never mints a QR here — only keeps an existing mirror in sync (see generateStretcherQr).
  const a = { ...cleanStretcher(updates), updatedAt: serverTimestamp() }
  const batch = writeBatch(db)
  batch.update(stretcherRef(orgId, id), a)
  if (updates.qrToken) batch.set(qrRef(updates.qrToken), stretcherMirror(orgId, orgName, id, { ...updates, ...a, qrToken: updates.qrToken }))
  await batch.commit()
  await logAudit(orgId, actor, 'stretcher.update', { target: 'stretcher', targetId: id, targetLabel: `${updates.assetId || 'Stretcher'} @ ${updates.centerName}`, summary: 'Stretcher updated' })
  return updates.qrToken || null
}

/** Admin-only: mint (or re-use) a QR token for a stretcher and write its public mirror. */
export async function generateStretcherQr(orgId, orgName, asset, actor) {
  const qrToken = asset.qrToken || generateQrToken()
  const batch = writeBatch(db)
  batch.update(stretcherRef(orgId, asset.id), { qrToken, updatedAt: serverTimestamp() })
  batch.set(qrRef(qrToken), stretcherMirror(orgId, orgName, asset.id, { ...asset, qrToken }))
  await batch.commit()
  await logAudit(orgId, actor, 'stretcher.qr_generate', { target: 'stretcher', targetId: asset.id, targetLabel: `${asset.assetId || 'Stretcher'} @ ${asset.centerName}`, summary: 'QR code generated' })
  return qrToken
}

/** Log an inspection: stamps last inspection today, sets the next due, marks Ready. */
export async function serviceStretcher(orgId, orgName, asset, nextInspection, actor) {
  const today = new Date().toISOString().slice(0, 10)
  const merged = { ...asset, lastInspection: today, nextInspection: nextInspection || '', status: 'ready' }
  const a = { ...cleanStretcher(merged), updatedAt: serverTimestamp() }
  const batch = writeBatch(db)
  batch.update(stretcherRef(orgId, asset.id), a)
  if (asset.qrToken) batch.set(qrRef(asset.qrToken), stretcherMirror(orgId, orgName, asset.id, { ...merged, qrToken: asset.qrToken }))
  await batch.commit()
  await logAudit(orgId, actor, 'stretcher.service', { target: 'stretcher', targetId: asset.id, targetLabel: `${asset.assetId || 'Stretcher'} @ ${asset.centerName}`, summary: `Stretcher inspected — next inspection ${nextInspection || '—'}` })
}

export async function deleteStretcher(orgId, id, qrToken, actor, label) {
  const batch = writeBatch(db)
  batch.delete(stretcherRef(orgId, id))
  if (qrToken) batch.delete(qrRef(qrToken))
  await batch.commit()
  await logAudit(orgId, actor, 'stretcher.delete', { target: 'stretcher', targetId: id, targetLabel: label || '' })
}

/** Bulk-delete stretchers (+ remove their QR mirrors) by [{id, qrToken}]. */
export async function bulkDeleteStretchers(orgId, items, actor) {
  for (let i = 0; i < items.length; i += BULK_CHUNK) {
    const batch = writeBatch(db)
    for (const { id, qrToken } of items.slice(i, i + BULK_CHUNK)) {
      batch.delete(stretcherRef(orgId, id))
      if (qrToken) batch.delete(qrRef(qrToken))
    }
    await batch.commit()
  }
  await logAudit(orgId, actor, 'stretcher.bulk_delete', { target: 'stretcher', summary: `${items.length} stretcher(s) deleted` })
}

export async function bulkAddStretchers(orgId, orgName, rows, actor) {
  let created = 0
  for (let i = 0; i < rows.length; i += BULK_CHUNK) {
    const batch = writeBatch(db)
    for (const row of rows.slice(i, i + BULK_CHUNK)) {
      const ref = doc(stretcherCol(orgId))
      const qrToken = generateQrToken()
      const a = { ...cleanStretcher(row), qrToken, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
      batch.set(ref, a)
      batch.set(qrRef(qrToken), stretcherMirror(orgId, orgName, ref.id, a))
      created++
    }
    await batch.commit()
  }
  await logAudit(orgId, actor, 'stretcher.bulk_create', { target: 'stretcher', summary: `Bulk added ${created} stretcher(s)` })
  return { created }
}

// ── FAS (Fire Alarm System) device inventory (org-scoped) ─────────────────────
export function subscribeFas(orgId, cb) {
  const q = query(fasCol(orgId), orderBy('createdAt', 'desc'), limit(COLLECTION_READ_CAP))
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => { if (!isSessionEnd('fire alarm devices', err)) console.warn('[Fire Marshal] FAS subscribe failed:', err?.message || err) }
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

/**
 * Where an approved defect lands, per asset kind.
 *
 * A table rather than the `isFas ? fasRef : aedRef` ternary this replaces. That
 * ternary had no third answer: any kind that was not 'fas' updated the AED
 * collection, so a stretcher report would have written to an AED document id
 * that does not exist there — a failed batch surfacing as "could not update the
 * report", with nothing naming the real cause. An unknown kind is refused here
 * instead, and says which one it was.
 */
const ASSET_TARGETS = {
  aed: { ref: aedRef, faultStatus: 'out_of_service', faultLabel: 'Out of service' },
  fas: { ref: fasRef, faultStatus: 'faulty', faultLabel: 'Faulty' },
  stretcher: { ref: stretcherRef, faultStatus: 'out_of_service', faultLabel: 'Out of service' },
}

/** Approve (→ mark the asset Faulty/Out-of-service) or reject an asset-defect report. */
export async function decideAssetReport(orgId, report, approve, reviewerName, actor) {
  const target = ASSET_TARGETS[report.assetKind]
  if (!target) throw new Error(`Unknown asset kind "${report.assetKind || ''}" — this report cannot be actioned`)
  const batch = writeBatch(db)
  batch.update(reportRef(orgId, report.id), {
    approvalStatus: approve ? 'approved' : 'rejected',
    reviewedBy: reviewerName || '',
    reviewedAt: serverTimestamp(),
  })
  if (approve && report.assetRefId) {
    batch.update(target.ref(orgId, report.assetRefId), { status: target.faultStatus, updatedAt: serverTimestamp() })
    if (report.token) batch.update(qrRef(report.token), { status: target.faultStatus, updatedAt: serverTimestamp() })
  }
  await batch.commit()
  await logAudit(orgId, actor, `${report.assetKind}.defect_${approve ? 'approved' : 'rejected'}`, {
    target: report.assetKind, targetId: report.assetRefId || '', targetLabel: report.assetLabel || '',
    summary: `${report.defect}${approve ? ` — marked ${target.faultLabel}` : ' — dismissed'}`,
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
