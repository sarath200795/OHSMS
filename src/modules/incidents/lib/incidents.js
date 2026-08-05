// ─────────────────────────────────────────────────────────────────────────────
// All incident data access: org-scoped paths, the resumable 5-step document,
// the photos/medical-records subcollection, soft-delete, and the dashboard stats
// counter (maintained with increment() deltas, fire-and-forget).
// ─────────────────────────────────────────────────────────────────────────────
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  limit,
  increment,
} from 'firebase/firestore'
import { db } from '../firebase'
import { logAudit } from './firestore'
import { AUDIT, diffSummary } from './audit'
import { statsDeltaFor, emptyStats, BUCKETS } from './stats'
import { reserveDocId } from '../../../shared/docId/reserve'
import { putFile, removeFile } from '../../../shared/storage'

const BUCKET_NAMES = Object.keys(BUCKETS)

// ── Path helpers ─────────────────────────────────────────────────────────────
const incidentCol = (orgId) => collection(db, 'organizations', orgId, 'incidents')
const incidentRef = (orgId, id) => doc(db, 'organizations', orgId, 'incidents', id)
const photoCol = (orgId, id) => collection(db, 'organizations', orgId, 'incidents', id, 'photos')
const photoRef = (orgId, id, pid) => doc(db, 'organizations', orgId, 'incidents', id, 'photos', pid)
const statsRef = (orgId) => doc(db, 'organizations', orgId, 'meta', 'stats')

export const INCIDENT_LOAD_CAP = 2000

// ── Stats counter ─────────────────────────────────────────────────────────────
// Apply a sparse delta as increment() field updates. NON-BLOCKING — never throws
// out; a stats failure must not roll back the real write. Uses updateDoc (which
// interprets dotted field paths e.g. "bySeverity.high"), self-healing the doc if
// it doesn't exist yet.
async function bumpStats(orgId, delta) {
  if (!delta) return
  const fields = {}
  if (delta.total) fields.total = increment(delta.total)
  if (delta.nextSeq) fields.nextSeq = increment(delta.nextSeq)
  for (const bucket of BUCKET_NAMES) {
    const m = delta[bucket]
    if (!m) continue
    for (const k of Object.keys(m)) if (m[k]) fields[`${bucket}.${k}`] = increment(m[k])
  }
  if (Object.keys(fields).length === 0) return
  fields.updatedAt = serverTimestamp()
  try {
    await updateDoc(statsRef(orgId), fields)
  } catch (e) {
    try {
      await setDoc(statsRef(orgId), emptyStats(), { merge: true })
      await updateDoc(statsRef(orgId), fields)
    } catch (e2) {
      // eslint-disable-next-line no-console
      console.warn('[Incident IRA] stats update skipped:', e2?.message || e2)
    }
  }
}

export function subscribeStats(orgId, cb) {
  return onSnapshot(statsRef(orgId), (snap) => cb(snap.exists() ? snap.data() : null))
}

// ── Incident document ─────────────────────────────────────────────────────────

/**
 * Normalize an incident's investigations to an array. New incidents store
 * `investigations: [{ id, method, diagram, summary, pngPhotoId }]`; older docs
 * stored a single `investigation` object — wrap it for backward compatibility.
 */
export function incidentInvestigations(incident) {
  if (Array.isArray(incident?.investigations)) return incident.investigations
  const legacy = incident?.investigation
  if (legacy && legacy.method) {
    return [{ id: 'legacy', method: legacy.method, diagram: legacy.diagram, summary: legacy.summary || '', pngPhotoId: legacy.pngPhotoId || null }]
  }
  return []
}

const pad4 = (n) => String(n).padStart(4, '0')

/** Create a new incident (optionally pre-filled with Step-1 data). Returns id. */
export async function createIncident(orgId, actor, initial = {}) {
  // Reserve a reference number from the running counter (tolerated gaps).
  const statsSnap = await getDoc(statsRef(orgId))
  const seq = ((statsSnap.exists() && statsSnap.data().nextSeq) || 0) + 1
  const year = new Date().getFullYear()
  const ref = doc(incidentCol(orgId))
  const incident = {
    // The org-wide document id. refNo is kept alongside it because incidents
    // raised before this scheme are quoted by that number in closed
    // investigations and emails, and dropping it would strand those references.
    docId: await reserveDocId(orgId, 'incidents'),
    refNo: `IRA-${year}-${pad4(seq)}`,
    lifecycle: 'reporting',
    stagesDone: { initial: false, team: false, investigation: false, capa: false, horizontal: false },
    deletedAt: null,
    closedAt: null,
    closedBy: null,
    // Step 1
    incidentDate: initial.incidentDate || '',
    incidentTime: initial.incidentTime || '',
    type: initial.type || '',
    severity: initial.severity || '',
    category: initial.category || '',
    location: initial.location || '',
    region: initial.region || '',
    entity: initial.entity || '',
    siteId: initial.siteId || '',
    site: initial.site || '',
    narrative: initial.narrative || '',
    probableCause: initial.probableCause || '',
    affectedPersonnel: initial.affectedPersonnel || [],
    photoCount: 0,
    // Step 1a
    injuryReports: initial.injuryReports || [],
    // Step 2
    team: initial.team || [],
    // Step 3
    investigations: [],
    // Step 4
    capa: [],
    // Step 5
    horizontal: { required: null, locations: [], details: '', completedAt: null },
    createdBy: actor?.uid || null,
    createdByName: actor?.name || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  await setDoc(ref, incident)
  const delta = statsDeltaFor(null, incident) || {}
  delta.nextSeq = 1
  await bumpStats(orgId, delta)
  await logAudit(orgId, actor, AUDIT.INCIDENT_CREATE, {
    target: 'incident',
    targetId: ref.id,
    targetLabel: incident.docId,
    summary: `Incident ${incident.docId} created`,
  })
  return ref.id
}

/**
 * Update an incident; keeps the stats counter in sync. `opts` = { actor, action,
 * summary, silent } drives the audit entry. Supports dotted-path updates for
 * nested fields (e.g. 'investigation.method', 'stagesDone.team') — those are
 * passed straight through to updateDoc.
 */
export async function updateIncident(orgId, id, updates, opts = {}) {
  const current = await getDoc(incidentRef(orgId, id))
  if (!current.exists()) throw new Error('Incident not found')
  const before = current.data()
  // Build a shallow "merged" view for the stats delta (only top-level dimension
  // fields matter: type/severity/category/location/lifecycle/deletedAt).
  const merged = { ...before }
  for (const [k, v] of Object.entries(updates)) {
    if (!k.includes('.')) merged[k] = v
  }
  await updateDoc(incidentRef(orgId, id), { ...updates, updatedAt: serverTimestamp() })
  await bumpStats(orgId, statsDeltaFor(before, merged))
  if (!opts.silent) {
    await logAudit(orgId, opts.actor, opts.action || AUDIT.INCIDENT_UPDATE, {
      target: 'incident',
      targetId: id,
      targetLabel: before.refNo || id,
      summary: opts.summary || diffSummary(before, merged),
    })
  }
}

export async function getIncident(orgId, id) {
  const snap = await getDoc(incidentRef(orgId, id))
  return snap.exists() ? { id, ...snap.data() } : null
}

export function subscribeIncidents(orgId, cb, max = INCIDENT_LOAD_CAP) {
  const q = query(incidentCol(orgId), orderBy('createdAt', 'desc'), limit(max))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
}

/** Mark an incident closed (after horizontal-deployment step). */
export async function closeIncident(orgId, id, actor) {
  await updateIncident(orgId, id, {
    lifecycle: 'closed',
    'stagesDone.horizontal': true,
    closedAt: serverTimestamp(),
    closedBy: actor?.name || '',
  }, { actor, action: AUDIT.INCIDENT_CLOSE, summary: 'Incident closed' })
}

// ── Soft delete / restore / purge ─────────────────────────────────────────────
export async function deleteIncident(orgId, id, actor) {
  const snap = await getDoc(incidentRef(orgId, id))
  if (!snap.exists()) return
  const before = snap.data()
  await updateDoc(incidentRef(orgId, id), { deletedAt: serverTimestamp(), deletedBy: actor?.name || '' })
  await bumpStats(orgId, statsDeltaFor(before, { ...before, deletedAt: true }))
  await logAudit(orgId, actor, AUDIT.INCIDENT_DELETE, { target: 'incident', targetId: id, targetLabel: before.refNo || id })
}

export async function restoreIncident(orgId, id, actor) {
  const snap = await getDoc(incidentRef(orgId, id))
  if (!snap.exists()) return
  const data = snap.data()
  await updateDoc(incidentRef(orgId, id), { deletedAt: null, deletedBy: null, updatedAt: serverTimestamp() })
  await bumpStats(orgId, statsDeltaFor({ ...data, deletedAt: true }, { ...data, deletedAt: null }))
  await logAudit(orgId, actor, AUDIT.INCIDENT_RESTORE, { target: 'incident', targetId: id, targetLabel: data.refNo || id })
}

export async function purgeIncident(orgId, id, actor, label) {
  // Remove photos subcollection then the doc.
  const photos = await getDocs(photoCol(orgId, id))
  photos.docs.forEach((d) => { if (d.data().path) removeFile(d.data().path) })
  const batch = writeBatch(db)
  photos.docs.forEach((d) => batch.delete(d.ref))
  batch.delete(incidentRef(orgId, id))
  await batch.commit()
  await logAudit(orgId, actor, AUDIT.INCIDENT_PURGE, { target: 'incident', targetId: id, targetLabel: label || id })
}

// ── Photos / medical records subcollection ────────────────────────────────────
export async function addIncidentPhoto(orgId, id, photo) {
  // Cloud first; the photo document then holds a URL instead of the image.
  // putFile returning null (bucket not enabled, offline) keeps the legacy
  // inline path, so evidence upload never fails harder than it used to.
  const up = photo.dataUrl ? await putFile(orgId, 'incident-photos', photo.dataUrl, photo.name) : null
  const ref = await addDoc(photoCol(orgId, id), {
    name: photo.name || '',
    type: photo.type || '',
    dataUrl: up ? '' : photo.dataUrl,
    url: up?.url || '',
    path: up?.path || '',
    size: photo.size || 0,
    caption: photo.caption || '',
    kind: photo.kind || 'photo', // 'photo' | 'medical_record' | 'diagram'
    uploadedBy: photo.uploadedBy || '',
    uploadedAt: serverTimestamp(),
  })
  await updateDoc(incidentRef(orgId, id), { photoCount: increment(1), updatedAt: serverTimestamp() })
  return ref.id
}

export function subscribeIncidentPhotos(orgId, id, cb) {
  const q = query(photoCol(orgId, id), orderBy('uploadedAt', 'asc'))
  // Normalised at the seam: every renderer (gallery, report doc, PDF) reads
  // .dataUrl, whichever era the photo was saved in.
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => {
    const data = d.data()
    return { id: d.id, ...data, dataUrl: data.dataUrl || data.url || '' }
  })))
}

export async function deleteIncidentPhoto(orgId, id, photoId) {
  // The doc is the only thing that remembers the cloud path — read it first.
  try {
    const snap = await getDoc(photoRef(orgId, id, photoId))
    if (snap.data()?.path) removeFile(snap.data().path)
  } catch { /* orphan tolerated */ }
  await deleteDoc(photoRef(orgId, id, photoId))
  await updateDoc(incidentRef(orgId, id), { photoCount: increment(-1), updatedAt: serverTimestamp() })
}
