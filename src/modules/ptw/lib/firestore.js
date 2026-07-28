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
  writeBatch,
  limit,
  runTransaction,
  arrayUnion,
} from 'firebase/firestore'
import { db } from '../firebase'
import { AUDIT } from './audit'
import { ROLES } from './permissions'
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
const userRef = (uid) => doc(db, 'users', uid)
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

export function subscribeAuditLogs(orgId, cb) {
  const q = query(auditCol(orgId), orderBy('at', 'desc'), limit(300))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
}

// ── Organizations & users ──────────────────────────────────────────────────────

/** Create an org + its first admin user + public name index, atomically. */
export async function createOrganization({ orgName, address, uid, name, email, phone }) {
  const org = doc(collection(db, 'organizations'))
  const batch = writeBatch(db)
  batch.set(org, {
    name: orgName,
    nameLower: orgName.trim().toLowerCase(),
    address: address || '',
    createdBy: uid,
    createdAt: serverTimestamp(),
  })
  batch.set(userRef(uid), {
    name,
    email,
    phone: phone || '',
    orgId: org.id,
    orgName,
    role: ROLES.ADMIN,
    status: 'approved',
    createdAt: serverTimestamp(),
  })
  batch.set(orgIndexRef(orgName), { orgId: org.id, name: orgName })
  await batch.commit()
  return org.id
}

export async function findOrgByName(orgName) {
  const snap = await getDoc(orgIndexRef(orgName))
  if (!snap.exists()) return null
  const d = snap.data()
  return { id: d.orgId, name: d.name }
}

/** List every organization (public orgIndex), [{id,name}] sorted by name. */
export async function listOrganizations() {
  const snap = await getDocs(collection(db, 'orgIndex'))
  return snap.docs
    .map((d) => ({ id: d.data().orgId, name: d.data().name }))
    .filter((o) => o.id && o.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}

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

/** Create a pending member joining an existing org. Defaults to Technician. */
export async function createPendingMember({ uid, name, email, phone, orgId, orgName }) {
  await setDoc(userRef(uid), {
    name,
    email,
    phone: phone || '',
    orgId,
    orgName,
    role: ROLES.TECHNICIAN,
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

export function subscribeOrg(orgId, cb) {
  return onSnapshot(orgRef(orgId), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null))
}

/** Admin: set the organization's list of work sites. */
export async function updateOrgSites(orgId, sites, actor) {
  await updateDoc(orgRef(orgId), { sites })
  await logAudit(orgId, actor, AUDIT.ORG_SITES, { target: 'org', summary: `Updated sites (${sites.length})` })
}

export async function setUserStatus(uid, status, orgId, actor, userLabel) {
  await updateDoc(userRef(uid), { status })
  await logAudit(orgId, actor, AUDIT.USER_STATUS, {
    target: 'user', targetId: uid, targetLabel: userLabel || uid, summary: `Set status → ${status}`,
  })
}

export async function setUserRole(uid, role, orgId, actor, userLabel) {
  await updateDoc(userRef(uid), { role })
  await logAudit(orgId, actor, AUDIT.USER_ROLE, {
    target: 'user', targetId: uid, targetLabel: userLabel || uid, summary: `Set role → ${role}`,
  })
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
    token: p.qrToken,
    permitNo: p.permitNo,
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

export async function getPermitByToken(token) {
  const snap = await getDoc(qrRef(token))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
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
    await addDoc(docCol(orgId, ref.id), {
      key: d.key,
      label: d.label || '',
      mandatory: Boolean(d.mandatory),
      fileName: d.fileName || '',
      fileType: d.fileType || '',
      fileData: d.fileData || '',
      size: d.size || 0,
      uploadedByName: actor?.name || '',
      uploadedAt: serverTimestamp(),
    })
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

// ── Permit documents (base64 files in a subcollection) ───────────────────────
export function subscribePermitDocuments(orgId, permitId, cb) {
  const q = query(docCol(orgId, permitId), orderBy('uploadedAt', 'asc'))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
}

/** Attach a document to an existing permit; updates attachedDocKeys. */
export async function addPermitDocument(orgId, permitId, meta, actor) {
  await addDoc(docCol(orgId, permitId), {
    key: meta.key || 'extra',
    label: meta.label || '',
    mandatory: Boolean(meta.mandatory),
    fileName: meta.fileName || '',
    fileType: meta.fileType || '',
    fileData: meta.fileData || '',
    size: meta.size || 0,
    uploadedByName: actor?.name || '',
    uploadedAt: serverTimestamp(),
  })
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

/** Edit core permit fields (approver only). */
export async function updatePermit(orgId, id, updates, actor) {
  await updateDoc(permitRef(orgId, id), { ...updates, updatedAt: serverTimestamp() })
  await logAudit(orgId, actor, AUDIT.PERMIT_EDIT, {
    targetId: id, targetLabel: updates.permitNo || id, summary: `Edited: ${Object.keys(updates).join(', ')}`,
  })
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
