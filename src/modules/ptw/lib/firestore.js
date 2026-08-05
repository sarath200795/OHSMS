// ─────────────────────────────────────────────────────────────────────────────
// All Firestore access for Permit to Work: org-scoped paths, the multi-org
// onboarding helpers, and the permit lifecycle (create → dual-team approval →
// closure / extension). Status is re-derived on read everywhere; we persist a
// `storedStatus` snapshot for list display + sorting.
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
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  limit,
  runTransaction,
  arrayUnion,
} from 'firebase/firestore'
import { db } from '../firebase'
import { reserveDocId } from '../../../shared/docId/reserve'
import { putFile, removeFile } from '../../../shared/storage'
import { AUDIT } from './audit'
import { computeWindow, derivePermitStatus } from './permitStatus'
import { generateQrToken } from './qr'

// ── Path helpers ─────────────────────────────────────────────────────────────
const orgRef = (orgId) => doc(db, 'organizations', orgId)
const permitCol = (orgId) => collection(db, 'organizations', orgId, 'permits')
const permitRef = (orgId, id) => doc(db, 'organizations', orgId, 'permits', id)
const docCol = (orgId, permitId) => collection(db, 'organizations', orgId, 'permits', permitId, 'documents')
const docRef = (orgId, permitId, docId) => doc(db, 'organizations', orgId, 'permits', permitId, 'documents', docId)
const obsCol = (orgId) => collection(db, 'organizations', orgId, 'observations')
const qrRef = (token) => doc(db, 'permitQr', token)
const auditCol = (orgId) => collection(db, 'organizations', orgId, 'auditLogs')
const countersRef = (orgId) => doc(db, 'organizations', orgId, 'meta', 'counters')
const orgIndexKey = (name) => (name || '').trim().toLowerCase()
const orgIndexRef = (name) => doc(db, 'orgIndex', orgIndexKey(name))

// ── Audit log ─────────────────────────────────────────────────────────────────
async function logAudit(orgId, actor, action, details = {}) {
  if (!orgId) return
  try {
    await addDoc(auditCol(orgId), {
      at: serverTimestamp(),
      actorUid: actor?.uid || null,
      actorName: actor?.name || 'Unknown',
      action,
      target: details.target || 'permit',
      targetId: details.targetId || null,
      targetLabel: details.targetLabel || '',
      summary: details.summary || '',
    })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[Permit to Work] audit log failed:', e?.message || e)
  }
}

// ── Organizations & users ──────────────────────────────────────────────────────

/** Self-heal the public orgIndex entry (idempotent, non-blocking). */
export async function ensureOrgIndex(org) {
  if (!org?.id || !org?.name) return
  try {
    const ref = orgIndexRef(org.name)
    const snap = await getDoc(ref)
    if (snap.exists()) return
    await setDoc(ref, { orgId: org.id, name: org.name })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[Permit to Work] orgIndex backfill skipped:', e?.message || e)
  }
}

// Delegated to the shared ref-counted org-users listener (one per org app-wide).
export { subscribeOrgUsers } from '../../../shared/org/orgData'

export function subscribeOrg(orgId, cb) {
  return onSnapshot(orgRef(orgId), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null))
}

// ── Permits ─────────────────────────────────────────────────────────────────

const emptyDecision = () => ({ status: 'pending', by: null, byName: '', at: null, note: '' })

/** Allocate the next sequential permit number for the org (PTW-YYYY-####). */
async function nextPermitNo(orgId, year) {
  const seq = await runTransaction(db, async (tx) => {
    const snap = await tx.get(countersRef(orgId))
    const cur = snap.exists() ? snap.data().permitSeq || 0 : 0
    const next = cur + 1
    tx.set(countersRef(orgId), { permitSeq: next }, { merge: true })
    return next
  })
  return `PTW-${year}-${String(seq).padStart(4, '0')}`
}

// ── Public QR mirror (permitQr/{token}) ──────────────────────────────────────
// World-readable copy of the status-relevant + display fields, so the public
// /permit/:token scan page can render live details + a countdown without auth.

// Status fields the public page feeds into derivePermitStatus, kept in sync.
function mirrorStatusFields(p) {
  return {
    storedStatus: derivePermitStatus(p, Date.now()),
    engineering: { status: p.engineering?.status || 'pending' },
    operations: { status: p.operations?.status || 'pending' },
    closure: p.closure
      ? { engineering: { status: p.closure.engineering?.status || 'pending' }, operations: { status: p.closure.operations?.status || 'pending' } }
      : null,
    extension: p.extension
      ? { engineering: { status: p.extension.engineering?.status || 'pending' }, operations: { status: p.extension.operations?.status || 'pending' }, newValidTo: p.extension.newValidTo || null }
      : null,
    closedDueToObservation: p.closedDueToObservation || null,
    validFrom: p.validFrom || null,
    validTo: p.validTo || null,
    updatedAt: serverTimestamp(),
  }
}

// Full mirror written at create / backfill (display + status fields).
function fullMirror(orgId, orgName, permitId, p) {
  return {
    orgId,
    orgName: orgName || '',
    permitId,
    // Every field is defaulted: Firestore rejects `undefined`, and permits that
    // predate a column — or arrived by import or seed — legitimately lack one.
    // permitNo was the exception, so publishing the mirror threw for exactly the
    // legacy permits this function exists to heal, and the QR stayed dead.
    token: p.qrToken || '',
    permitNo: p.permitNo || '',
    docId: p.docId || '',
    typeOfWork: p.typeOfWork || '',
    site: p.site || '',
    jobLocation: p.jobLocation || '',
    jobDescription: p.jobDescription || '',
    issuingDepartment: p.issuingDepartment || '',
    issuedToName: p.issuedToName || '',
    hazards: p.hazards || [],
    ppe: p.ppe || [],
    precautions: p.precautions || [],
    jsa: p.jsa || [],
    participants: (p.participants || []).map((x) => ({ name: x.name, type: x.type, company: x.company || '' })),
    fireWatchers: p.fireWatchers || [],
    confinedWatcher: p.confinedWatcher || null,
    createdByName: p.createdByName || '',
    ...mirrorStatusFields(p),
  }
}

/** Keep the public mirror's status fields current (fire-and-forget). */
export async function updatePermitMirror(token, mergedPermit) {
  if (!token) return
  try {
    await setDoc(qrRef(token), mirrorStatusFields(mergedPermit), { merge: true })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[Permit to Work] permit mirror sync skipped:', e?.message || e)
  }
}

export function subscribePermitByToken(token, cb, onError) {
  return onSnapshot(
    qrRef(token),
    (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    (err) => { if (onError) onError(err); else cb(null) }
  )
}

/**
 * Ensure a permit has a QR token AND a current public mirror. Generates the
 * token if missing, then UPSERTS the full mirror — so it self-heals permits
 * whose mirror write was previously blocked (e.g. before the permitQr rule was
 * deployed) even though the token already exists on the permit. Non-fatal.
 */
export async function ensurePermitQr(orgId, orgName, permit) {
  if (!permit?.id) return null
  let token = permit.qrToken
  try {
    if (!token) {
      token = generateQrToken()
      await updateDoc(permitRef(orgId, permit.id), { qrToken: token, updatedAt: serverTimestamp() })
    }
    await setDoc(qrRef(token), fullMirror(orgId, orgName, permit.id, { ...permit, qrToken: token }))
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[Permit to Work] permit QR mirror ensure skipped:', e?.message || e)
  }
  return token
}

/** Create a new permit (status Draft, both team approvals pending). */
export async function createPermit(orgId, data, actor) {
  const year = (data.date || new Date().toISOString().slice(0, 10)).slice(0, 4)
  const permitNo = await nextPermitNo(orgId, year)
  const { validFrom, validTo } = computeWindow(data.date, data.time)
  const qrToken = generateQrToken()
  const ref = doc(permitCol(orgId))
  const permit = {
    permitNo,
    docId: await reserveDocId(orgId, 'ptw'),
    qrToken,
    date: data.date || '',
    time: data.time || '',
    typeOfWork: data.typeOfWork || '',
    site: data.site || '',
    jobLocation: data.jobLocation || '',
    jobDescription: data.jobDescription || '',
    issuingDepartment: data.issuingDepartment || '',
    issuedToName: data.issuedToName || '',
    issuedToPhone: data.issuedToPhone || '',
    hazards: data.hazards || [],
    ppe: data.ppe || [],
    precautions: data.precautions || [],
    participants: data.participants || [],
    jsa: (data.jsa || []).filter((r) => r.step || r.hazard || r.precaution),
    fireWatchers: (data.fireWatchers || []).filter((w) => w.name),
    confinedWatcher: data.confinedWatcher?.name ? data.confinedWatcher : null,
    requiredDocs: data.requiredDocs || [],
    attachedDocKeys: (data.documents || []).map((d) => d.key),
    assignedEngineer: data.assignedEngineer || null,
    assignedOperator: data.assignedOperator || null,
    engineering: emptyDecision(),
    operations: emptyDecision(),
    closure: null,
    extension: null,
    validFrom,
    validTo,
    storedStatus: 'draft',
    createdBy: actor?.uid || null,
    createdByName: actor?.name || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  await setDoc(ref, permit)
  // Attached files live in a subcollection (each ≤ ~750 KB base64) so the parent
  // permit doc stays well under Firestore's 1 MB limit.
  for (const d of data.documents || []) {
    await addDoc(docCol(orgId, ref.id), await permitDocPayload(orgId, d, actor))
  }
  // Public QR mirror so the permit is scannable immediately.
  await setDoc(qrRef(qrToken), fullMirror(orgId, actor?.orgName, ref.id, permit)).catch((e) =>
    console.warn('[Permit to Work] mirror create skipped:', e?.message || e))
  await logAudit(orgId, actor, AUDIT.PERMIT_CREATE, {
    targetId: ref.id, targetLabel: permitNo, summary: `${permit.typeOfWork} @ ${permit.jobLocation}`,
  })
  return { id: ref.id, permitNo, qrToken }
}

// ── Observations (safety observations logged via QR scan or in-app) ──────────
export function subscribeObservations(orgId, cb) {
  const q = query(obsCol(orgId), orderBy('at', 'desc'), limit(500))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
}

export function subscribePermitObservations(orgId, permitId, cb) {
  const q = query(obsCol(orgId), where('permitId', '==', permitId))
  return onSnapshot(q, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    list.sort((a, b) => (b.at?.seconds || 0) - (a.at?.seconds || 0))
    cb(list)
  })
}

/**
 * Log a safety observation against a permit. A SAFE observation leaves the
 * permit open; an UNSAFE observation closes it for non-compliance (terminal).
 */
export async function createObservation(orgId, data, actor) {
  const ref = await addDoc(obsCol(orgId), {
    permitId: data.permitId,
    docId: await reserveDocId(orgId, 'observations'),
    permitNo: data.permitNo || '',
    token: data.token || '',
    type: data.type, // 'safe' | 'unsafe'
    note: data.note || '',
    observedBy: actor?.uid || null,
    observedByName: actor?.name || '',
    observedByRole: actor?.role || '',
    source: data.source || 'portal',
    at: serverTimestamp(),
  })

  if (data.type === 'unsafe') {
    const closure = {
      observationId: ref.id,
      by: actor?.uid || null,
      byName: actor?.name || '',
      at: new Date().toISOString(),
      note: data.note || '',
    }
    const current = await getPermit(orgId, data.permitId)
    const merged = { ...(current || {}), closedDueToObservation: closure }
    await updateDoc(permitRef(orgId, data.permitId), {
      closedDueToObservation: closure,
      storedStatus: 'closed_noncompliance',
      updatedAt: serverTimestamp(),
    })
    await updatePermitMirror(data.token || current?.qrToken, merged)
  }

  await logAudit(orgId, actor, data.type === 'unsafe' ? AUDIT.OBSERVATION_UNSAFE : AUDIT.OBSERVATION_SAFE, {
    targetId: data.permitId, targetLabel: data.permitNo || data.permitId,
    summary: `${data.type === 'unsafe' ? 'Unsafe — permit closed for non-compliance' : 'Safe observation'}${data.note ? ` — ${data.note}` : ''}`,
  })
  return ref.id
}

/** Who a QR observation can say they are. Free text would be worthless here. */
export const OBSERVER_ROLES = [
  'Worker on this permit',
  'Supervisor',
  'Safety officer',
  'Contractor',
  'Visitor',
  'Other',
]

/**
 * An observation logged by scanning the permit's QR code, by someone with no
 * account.
 *
 * Deliberately NOT the same as the signed-in path. A portal observation of
 * "unsafe" closes the permit for non-compliance on the spot; doing that from an
 * unauthenticated write would put a stop-work button on a token printed on a
 * sheet of paper that anyone can photograph. So a scanned observation is
 * recorded and left pending for an approver, exactly as a scanned equipment
 * defect is — the report is immediate, the consequence is a decision.
 *
 * It also cannot reserve a document id or write an audit entry, both of which
 * require membership. The observation is its own record.
 */
export async function createPublicObservation(orgId, data) {
  const ref = await addDoc(obsCol(orgId), {
    permitId: data.permitId,
    permitNo: data.permitNo || '',
    token: data.token || '',
    type: data.type === 'unsafe' ? 'unsafe' : 'safe',
    note: (data.note || '').slice(0, 500),
    observedBy: 'public',
    observedByName: data.reporterRole || 'QR Scan (Public)',
    observedByRole: data.reporterRole || '',
    source: 'qr',
    approvalStatus: 'pending',
    at: serverTimestamp(),
  })
  return ref.id
}

// ── Permit documents (base64 files in a subcollection) ───────────────────────
export function subscribePermitDocuments(orgId, permitId, cb) {
  const q = query(docCol(orgId, permitId), orderBy('uploadedAt', 'asc'))
  // fileData is normalised at the seam so the download links keep working for
  // both eras: inline base64 (legacy) and cloud URL (new).
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => {
    const data = d.data()
    return { id: d.id, ...data, fileData: data.fileData || data.fileUrl || '' }
  })))
}

/**
 * The stored shape of one attached document. Cloud storage first — the permit
 * subcollection doc then carries a URL instead of up to ~750KB of base64 —
 * falling back to inline when the bucket is unavailable, so attaching a
 * document never fails harder than it did before storage existed.
 */
async function permitDocPayload(orgId, meta, actor) {
  const up = meta.fileData ? await putFile(orgId, 'permit-documents', meta.fileData, meta.fileName) : null
  return {
    key: meta.key || 'extra',
    label: meta.label || '',
    mandatory: Boolean(meta.mandatory),
    fileName: meta.fileName || '',
    fileType: meta.fileType || '',
    fileData: up ? '' : meta.fileData || '',
    fileUrl: up?.url || '',
    filePath: up?.path || '',
    size: meta.size || 0,
    uploadedByName: actor?.name || '',
    uploadedAt: serverTimestamp(),
  }
}

/** Attach a document to an existing permit; updates attachedDocKeys. */
export async function addPermitDocument(orgId, permitId, meta, actor) {
  await addDoc(docCol(orgId, permitId), await permitDocPayload(orgId, meta, actor))
  if (meta.key) {
    await updateDoc(permitRef(orgId, permitId), {
      attachedDocKeys: arrayUnion(meta.key), updatedAt: serverTimestamp(),
    })
  }
  await logAudit(orgId, actor, AUDIT.PERMIT_EDIT, {
    targetId: permitId, summary: `Attached document: ${meta.label || meta.fileName || meta.key}`,
  })
}

export async function deletePermitDocument(orgId, permitId, docId, actor, label) {
  // The doc is the only record of its cloud path.
  try {
    const snap = await getDoc(docRef(orgId, permitId, docId))
    if (snap.data()?.filePath) removeFile(snap.data().filePath)
  } catch { /* orphan tolerated */ }
  await deleteDoc(docRef(orgId, permitId, docId))
  await logAudit(orgId, actor, AUDIT.PERMIT_EDIT, {
    targetId: permitId, summary: `Removed document: ${label || docId}`,
  })
}

export function subscribePermits(orgId, cb) {
  const q = query(permitCol(orgId), orderBy('createdAt', 'desc'), limit(1000))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
}

export async function getPermit(orgId, id) {
  const snap = await getDoc(permitRef(orgId, id))
  return snap.exists() ? { id, ...snap.data() } : null
}

/** Recompute + persist storedStatus when it drifts; keep the public mirror in sync. */
async function syncStoredStatus(orgId, id, merged) {
  const live = derivePermitStatus(merged, Date.now())
  if (merged.storedStatus !== live) {
    await updateDoc(permitRef(orgId, id), { storedStatus: live, updatedAt: serverTimestamp() })
  }
  await updatePermitMirror(merged.qrToken, merged)
}

/**
 * Opportunistically persist an expired permit's status (Not Closed) so the
 * repository/dashboard reflect it without a backend cron. Fire-and-forget.
 */
export async function reconcilePermitStatus(orgId, permit) {
  try {
    const live = derivePermitStatus(permit, Date.now())
    if (permit?.id && permit.storedStatus !== live) {
      await updateDoc(permitRef(orgId, permit.id), { storedStatus: live })
      await updatePermitMirror(permit.qrToken, permit)
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[Permit to Work] status reconcile skipped:', e?.message || e)
  }
}

/**
 * Delete a permit, its attached documents and its public QR mirror.
 *
 * The mirror goes first and on its own: leaving it behind would keep a scanned
 * QR answering for a permit that no longer exists, which is worse than the code
 * simply not resolving. The audit entry is written before the document is
 * removed, because afterwards there is nothing left to describe.
 */
export async function deletePermit(orgId, permit, actor) {
  const id = permit?.id
  if (!id) throw new Error('No permit to delete')

  await logAudit(orgId, actor, AUDIT.PERMIT_DELETE, {
    targetId: id,
    targetLabel: permit.permitNo || id,
    summary: `Deleted permit ${permit.permitNo || id}${permit.typeOfWork ? ` (${permit.typeOfWork})` : ''}`,
  })

  if (permit.qrToken) {
    try {
      await deleteDoc(qrRef(permit.qrToken))
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[Permit to Work] QR mirror delete skipped:', e?.message || e)
    }
  }

  // Attachments live in a subcollection, which deleting the parent leaves
  // orphaned and unreachable.
  const docs = await getDocs(docCol(orgId, id))
  for (const d of docs.docs) {
    if (d.data().filePath) removeFile(d.data().filePath)
    await deleteDoc(d.ref)
  }

  await deleteDoc(permitRef(orgId, id))
}

function decisionBlock(decision, actor, note) {
  return {
    status: decision, // 'approved' | 'rejected'
    by: actor?.uid || null,
    byName: actor?.name || '',
    at: new Date().toISOString(),
    note: note || '',
  }
}

/** Record a team's approve/reject decision on the permit itself. */
export async function decideApproval(orgId, permitId, team, decision, note, actor) {
  const current = await getPermit(orgId, permitId)
  if (!current) throw new Error('Permit no longer exists')
  const block = decisionBlock(decision, actor, note)
  const merged = { ...current, [team]: block }
  await updateDoc(permitRef(orgId, permitId), { [team]: block, updatedAt: serverTimestamp() })
  await syncStoredStatus(orgId, permitId, merged)
  await logAudit(orgId, actor, decision === 'approved' ? AUDIT.APPROVE : AUDIT.REJECT, {
    targetId: permitId, targetLabel: current.permitNo,
    summary: `${team} ${decision}${note ? ` — ${note}` : ''}`,
  })
}

/** The raiser submits the completed work for closure (both teams must approve). */
export async function requestClosure(orgId, permitId, actor) {
  const closure = {
    requestedBy: actor?.uid || null,
    requestedByName: actor?.name || '',
    requestedAt: new Date().toISOString(),
    engineering: emptyDecision(),
    operations: emptyDecision(),
  }
  await updateDoc(permitRef(orgId, permitId), { closure, updatedAt: serverTimestamp() })
  await logAudit(orgId, actor, AUDIT.CLOSURE_REQUEST, { targetId: permitId, summary: 'Submitted for closure' })
}

export async function decideClosure(orgId, permitId, team, decision, note, actor) {
  const current = await getPermit(orgId, permitId)
  if (!current?.closure) throw new Error('No closure request is pending')
  const block = decisionBlock(decision, actor, note)
  const closure = { ...current.closure, [team]: block }
  const merged = { ...current, closure }
  await updateDoc(permitRef(orgId, permitId), { closure, updatedAt: serverTimestamp() })
  await syncStoredStatus(orgId, permitId, merged)
  await logAudit(orgId, actor, AUDIT.CLOSURE_DECISION, {
    targetId: permitId, targetLabel: current.permitNo, summary: `Closure ${team} ${decision}`,
  })
}

/** Request a time extension (reason + new end + participant/risk changes). */
export async function requestExtension(orgId, permitId, { reason, newValidTo, participantChanges, riskChanges }, actor) {
  const extension = {
    requestedBy: actor?.uid || null,
    requestedByName: actor?.name || '',
    requestedAt: new Date().toISOString(),
    reason: reason || '',
    newValidTo: newValidTo || null,
    participantChanges: participantChanges || '',
    riskChanges: riskChanges || '',
    suggestions: [],
    engineering: emptyDecision(),
    operations: emptyDecision(),
  }
  await updateDoc(permitRef(orgId, permitId), { extension, updatedAt: serverTimestamp() })
  await logAudit(orgId, actor, AUDIT.EXTENSION_REQUEST, {
    targetId: permitId, summary: `Extension requested${reason ? ` — ${reason}` : ''}`,
  })
}

/** An approver adds a suggestion and may revise the proposed new end time. */
export async function addExtensionSuggestion(orgId, permitId, { text, newValidTo }, actor) {
  const updates = {
    'extension.suggestions': arrayUnion({
      by: actor?.uid || null,
      byName: actor?.name || '',
      text: text || '',
      at: new Date().toISOString(),
    }),
    updatedAt: serverTimestamp(),
  }
  if (newValidTo) updates['extension.newValidTo'] = newValidTo
  await updateDoc(permitRef(orgId, permitId), updates)
  await logAudit(orgId, actor, AUDIT.EXTENSION_SUGGESTION, {
    targetId: permitId, summary: `Suggestion: ${text || ''}${newValidTo ? ` (new end ${newValidTo})` : ''}`,
  })
}

export async function decideExtension(orgId, permitId, team, decision, note, actor) {
  const current = await getPermit(orgId, permitId)
  if (!current?.extension) throw new Error('No extension request is pending')
  const block = decisionBlock(decision, actor, note)
  const extension = { ...current.extension, [team]: block }
  const merged = { ...current, extension }
  // When both teams approve, the extended end becomes the permit's validTo.
  const bothApproved = extension.engineering?.status === 'approved' && extension.operations?.status === 'approved'
  const patch = { extension, updatedAt: serverTimestamp() }
  if (bothApproved && extension.newValidTo) {
    patch.validTo = extension.newValidTo
    merged.validTo = extension.newValidTo
  }
  await updateDoc(permitRef(orgId, permitId), patch)
  await syncStoredStatus(orgId, permitId, merged)
  await logAudit(orgId, actor, AUDIT.EXTENSION_DECISION, {
    targetId: permitId, targetLabel: current.permitNo, summary: `Extension ${team} ${decision}`,
  })
}
