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
import { db } from '../../../shared/firebase'
import { reserveDocId } from '../../../shared/docId/reserve'
import { snapshotHandlers } from '../../../shared/snapshotError'
import { putFile, removeFile, MAX_INLINE_BYTES, tooLargeForInline } from '../../../shared/storage'
import { AUDIT } from './audit'
import { computeWindow, derivePermitStatus } from './permitStatus'
import { mirrorDisplayFields } from './publicPermit'
import { generateQrToken } from './qr'
import { logAudit as logOrgAudit, orgIndexRef } from '../../../shared/org/orgData'

// ── Path helpers ─────────────────────────────────────────────────────────────
const orgRef = (orgId) => doc(db, 'organizations', orgId)
const permitCol = (orgId) => collection(db, 'organizations', orgId, 'permits')
const permitRef = (orgId, id) => doc(db, 'organizations', orgId, 'permits', id)
const docCol = (orgId, permitId) => collection(db, 'organizations', orgId, 'permits', permitId, 'documents')
const docRef = (orgId, permitId, docId) => doc(db, 'organizations', orgId, 'permits', permitId, 'documents', docId)
const obsCol = (orgId) => collection(db, 'organizations', orgId, 'observations')
const qrRef = (token) => doc(db, 'permitQr', token)
const countersRef = (orgId) => doc(db, 'organizations', orgId, 'meta', 'counters')

// ── Audit log ─────────────────────────────────────────────────────────────────
// One implementation, in shared/org/orgData; this wrapper adds only the module
// key and the default target. The private copy it replaces omitted BOTH
// `module` and `source`, so permit entries read as "Core" in Admin → Audit Log
// and carried no origin at all.
const logAudit = (orgId, actor, action, details = {}) =>
  logOrgAudit(orgId, actor, action, { module: 'ptw', target: 'permit', ...details })

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
    site: p.site || '',
    // Crew as COUNTS, and the display half withdrawn once the job is over —
    // see publicPermit.js. This published every participant's name and employer
    // to an unauthenticated URL for the life of the permit and then forever.
    ...mirrorDisplayFields(p),
    ...mirrorStatusFields(p),
  }
}

/** Keep the public mirror's status fields current (fire-and-forget). */
export async function updatePermitMirror(token, mergedPermit) {
  if (!token) return
  try {
    // The display half rides along, so a permit that closes has its detail
    // actively blanked rather than left behind by a merge that only ever
    // touched the status fields — which was the 'never withdrawn' half of it.
    await setDoc(
      qrRef(token),
      { ...mirrorDisplayFields(mergedPermit), ...mirrorStatusFields(mergedPermit) },
      { merge: true },
    )
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
  if (!up && meta.fileData && (meta.size || 0) > MAX_INLINE_BYTES) {
    throw new Error(tooLargeForInline(meta.fileName))
  }
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
  // PermitContext clears `loading` from the success callback only — without an
  // error handler the permit register spins for ever after one failed read.
  // See shared/snapshotError.js.
  const h = snapshotHandlers('permits', cb)
  return onSnapshot(q, (snap) => h.ok(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), h.err)
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
  const block = decisionBlock(decision, actor, note)
  // Read INSIDE the transaction, and write a dotted path.
  //
  // Both halves are needed and they fix different things. The dotted path stops
  // the write clobbering the sibling team's block: this used to send the whole
  // `closure` map, so engineering and operations — who are *expected* to act on
  // the same request at the same time — each sent a map in which the other was
  // still `pending`, and the second write erased the first approval, leaving a
  // permit both teams had signed off reading as Not Closed.
  //
  // The transaction is what makes the DERIVED state right. `merged` feeds
  // syncStoredStatus, which recomputes storedStatus and the QR mirror a worker
  // scans at the barrier. Built from a read taken before the write, `merged`
  // can be missing the sibling's approval even though the server now has it —
  // so the mirror would say IN PROGRESS about a permit that is closed. Reading
  // in the transaction means a concurrent decision retries and the second
  // caller sees both.
  const merged = await runTransaction(db, async (tx) => {
    const snap = await tx.get(permitRef(orgId, permitId))
    const current = snap.exists() ? { id: permitId, ...snap.data() } : null
    if (!current?.closure) throw new Error('No closure request is pending')
    tx.update(permitRef(orgId, permitId), {
      [`closure.${team}`]: block,
      updatedAt: serverTimestamp(),
    })
    return { ...current, closure: { ...current.closure, [team]: block } }
  })
  await syncStoredStatus(orgId, permitId, merged)
  await logAudit(orgId, actor, AUDIT.CLOSURE_DECISION, {
    targetId: permitId, targetLabel: merged.permitNo, summary: `Closure ${team} ${decision}`,
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
  const block = decisionBlock(decision, actor, note)
  // See decideClosure for why this reads inside the transaction. The stakes are
  // higher here, and a dotted path ALONE would have made them worse rather than
  // better.
  //
  // `bothApproved` is what promotes the extension's new end time to the
  // permit's `validTo`. Computed from a read taken before the write, neither of
  // two simultaneous approvers ever sees it become true: each one's local copy
  // has the other still `pending`. With the old wholesale write that was
  // recoverable — the second write left one team pending, so somebody had to
  // approve again and `validTo` landed then. With a dotted write the server
  // ends up showing BOTH teams approved and `validTo` never written, and
  // nobody will ever re-approve a request that looks complete. A crew works on
  // under an extension the permit does not record.
  //
  // Reading in the transaction means the second caller retries against a state
  // that already contains the first approval, sees bothApproved, and writes
  // validTo in the same commit. It also stops the wholesale write dropping any
  // suggestion addExtensionSuggestion appended in between.
  const merged = await runTransaction(db, async (tx) => {
    const snap = await tx.get(permitRef(orgId, permitId))
    const current = snap.exists() ? { id: permitId, ...snap.data() } : null
    if (!current?.extension) throw new Error('No extension request is pending')

    const extension = { ...current.extension, [team]: block }
    const patch = { [`extension.${team}`]: block, updatedAt: serverTimestamp() }
    const next = { ...current, extension }

    // When both teams approve, the extended end becomes the permit's validTo.
    const bothApproved = extension.engineering?.status === 'approved'
      && extension.operations?.status === 'approved'
    if (bothApproved && extension.newValidTo) {
      patch.validTo = extension.newValidTo
      next.validTo = extension.newValidTo
    }
    tx.update(permitRef(orgId, permitId), patch)
    return next
  })
  await syncStoredStatus(orgId, permitId, merged)
  await logAudit(orgId, actor, AUDIT.EXTENSION_DECISION, {
    targetId: permitId, targetLabel: merged.permitNo, summary: `Extension ${team} ${decision}`,
  })
}
