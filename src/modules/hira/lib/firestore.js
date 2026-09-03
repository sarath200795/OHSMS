// ─────────────────────────────────────────────────────────────────────────────
// All Firestore access goes through here. Org-scoped paths:
//   organizations/{orgId}                          — org doc
//   organizations/{orgId}/assessments/{id}         — risk assessments
//   users/{uid}                                    — user profiles
//   orgIndex/{slug}                                — public name→org index (signup)
// ─────────────────────────────────────────────────────────────────────────────
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  runTransaction,
  limit,
} from 'firebase/firestore'
import { db } from '../../../shared/firebase'
import { isSessionEnd } from '../../../shared/sessionEnd'
import { reserveDocId } from '../../../shared/docId/reserve'

// ── Path helpers ─────────────────────────────────────────────────────────────
const orgRef = (orgId) => doc(db, 'organizations', orgId)
const assessmentCol = (orgId) => collection(db, 'organizations', orgId, 'assessments')
const assessmentRef = (orgId, id) => doc(db, 'organizations', orgId, 'assessments', id)

// ── Organizations & users ─────────────────────────────────────────────────────

// Default snapshot error handler: log a warning instead of letting Firestore
// raise an "Uncaught Error in snapshot listener" that can hang/blank the UI.
const onSnapErr = (label) => (err) => {
  if (isSessionEnd(label, err)) return
  // eslint-disable-next-line no-console
  console.warn(`[HIRA] ${label} listener error:`, err?.code || err?.message || err)
}

// Delegated to the shared ref-counted org-users listener (one per org app-wide).
export { subscribeOrgUsers } from '../../../shared/org/orgData'

/** Live org document (name, address, sites, …). */
export function subscribeOrg(orgId, cb, onError) {
  return onSnapshot(orgRef(orgId), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null), onError || onSnapErr('org'))
}

// ── Activity log (append-only audit trail) ────────────────────────────────────
const activityCol = (orgId) => collection(db, 'organizations', orgId, 'activity')

/** Record a user action. Fire-and-forget — never blocks the main operation. */
export function logActivity(orgId, actor, { type, message, assessmentId = null }) {
  if (!orgId) return
  addDoc(activityCol(orgId), {
    type: type || 'event',
    message: message || '',
    assessmentId,
    actorUid: actor?.uid || null,
    actorName: actor?.name || 'Someone',
    at: serverTimestamp(),
  }).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn('[HIRA] activity log failed:', e?.message || e)
  })
}

export function subscribeActivity(orgId, cb, onError, max = 50) {
  const q = query(activityCol(orgId), orderBy('at', 'desc'), limit(max))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError || onSnapErr('activity'))
}

// ── Risk assessments ──────────────────────────────────────────────────────────

const ASSESSMENT_LOAD_CAP = 1000

export function subscribeAssessments(orgId, cb, onError, max = ASSESSMENT_LOAD_CAP) {
  const q = query(assessmentCol(orgId), orderBy('createdAt', 'desc'), limit(max))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError || onSnapErr('assessments'))
}

/** Strip undefined values so Firestore accepts the nested write. */
function clean(value) {
  if (Array.isArray(value)) return value.map(clean)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = clean(v)
    }
    return out
  }
  return value
}

export async function createAssessment(orgId, data, actor) {
  const ref = await addDoc(assessmentCol(orgId), {
    ...clean(data),
    docId: await reserveDocId(orgId, 'hira'),
    createdBy: actor?.uid || null,
    createdByName: actor?.name || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateAssessment(orgId, id, data) {
  await updateDoc(assessmentRef(orgId, id), {
    ...clean(data),
    updatedAt: serverTimestamp(),
  })
}

/**
 * Patch ONE additional control, re-reading the assessment inside a transaction.
 *
 * The Action Tracker used to build the new `activities` tree from the copy in
 * its subscription list and hand the whole thing to updateAssessment. An
 * assessment is a single document with every activity, hazard and control
 * nested inside it, so that wrote back the ENTIRE risk assessment as it looked
 * when the last snapshot arrived — and anything committed in between was
 * reverted. Someone in CreateAssessment adding a hazard while a supervisor
 * ticked off an unrelated action lost the hazard, silently, with no audit trail
 * and nothing on either screen to say so. On a risk register that is the worst
 * kind of data loss: the record still looks complete.
 *
 * The write is still whole-document, because the shape gives no choice — you
 * cannot address `activities[2].hazards[5].additionalControls[1].status` with a
 * dotted path when the arrays are positional. What changes is WHERE the base
 * state comes from: read inside the transaction, so a concurrent write makes
 * Firestore retry this function against the new state instead of overwriting
 * it. The patch is re-applied to whatever the tree looks like at commit time.
 *
 * (The structural fix is to move additional controls into their own
 * subcollection so a status change is a one-document write. That is a data
 * migration; this closes the hole without one.)
 */
export async function patchAssessmentControl(orgId, id, { activityId, hazardId, controlId }, patch) {
  return patchAssessmentNode(orgId, id, { activityId, hazardId, controlId }, patch, 'action')
}

/**
 * Patch ONE hazard, on the same terms. Used by the Risk Register's ALARP
 * declaration, which had the identical whole-tree defect: it rebuilt
 * `activities` from the subscription copy and handed the lot to
 * updateAssessment, so accepting one residual risk reverted every concurrent
 * edit to the assessment — including an action status the tracker had just
 * committed through the function above.
 */
export async function patchAssessmentHazard(orgId, id, { activityId, hazardId }, patch) {
  return patchAssessmentNode(orgId, id, { activityId, hazardId, controlId: null }, patch, 'hazard')
}

/**
 * The shared body. `controlId === null` patches the hazard itself; otherwise it
 * patches one additional control inside that hazard.
 */
async function patchAssessmentNode(orgId, id, { activityId, hazardId, controlId }, patch, label) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(assessmentRef(orgId, id))
    if (!snap.exists()) throw new Error('That assessment no longer exists')
    const data = snap.data()

    let found = false
    const patchHazard = (h) => {
      if (controlId === null) {
        found = true
        return { ...h, ...patch }
      }
      return {
        ...h,
        additionalControls: (h.additionalControls || []).map((c) => {
          if (c.id !== controlId) return c
          found = true
          return { ...c, ...patch }
        }),
      }
    }

    const activities = (data.activities || []).map((act) =>
      act.id !== activityId ? act : {
        ...act,
        hazards: (act.hazards || []).map((h) => (h.id !== hazardId ? h : patchHazard(h))),
      })

    // The node can genuinely be gone — someone deleted the hazard while this row
    // was on screen. Writing the tree back anyway would resurrect nothing and
    // silently discard the edit; saying so lets the user refresh.
    if (!found) throw new Error(`That ${label} is no longer on this assessment. Refresh to see the current version.`)

    tx.update(assessmentRef(orgId, id), { activities, updatedAt: serverTimestamp() })
  })
}

export async function deleteAssessment(orgId, id) {
  await deleteDoc(assessmentRef(orgId, id))
}

/** Bulk create assessments (from CSV import) in chunked batches. `kind` marks
 *  the imported rows as 'site' (normal) or 'baseline' (activity template). */
export async function bulkCreateAssessments(orgId, list, actor, kind = 'site') {
  let created = 0
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200)
    const batch = writeBatch(db)
    for (const data of chunk) {
      const ref = doc(assessmentCol(orgId))
      batch.set(ref, {
        ...clean(data),
        kind,
        baselineId: '',
        createdBy: actor?.uid || null,
        createdByName: actor?.name || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      created++
    }
    await batch.commit()
  }
  return created
}
