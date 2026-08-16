// ─────────────────────────────────────────────────────────────────────────────
// Standalone, per-person Injury Reports. Each injury captured inside an incident
// (Step 1a) is reviewed and VERIFIED here, independently of the parent incident.
// Keyed deterministically by `${incidentId}__${personId}` so re-saving an
// incident updates (never dupes). Verification status is preserved across
// re-syncs (we never overwrite it here).
//
// This collection is also the ONLY home of a named colleague's clinical detail —
// body parts, injury type, medication, first-aid detail, days off. It used to be
// a second copy: the same fields rode along on the parent incident as
// injuryReports[]. An ISO 27001 audit found what that meant. /injuries is gated
// to admin and manager precisely to keep the external auditor out, but incidents
// are readable by every approved member AND by the auditor, so one
// getDocs(collection(db,'organizations',ORG,'incidents')) returned the medical
// record of every injured person in the tenant. Gating the second copy was never
// going to work; there is now only one copy, and the incident keeps nothing but
// the key needed to find it.
// ─────────────────────────────────────────────────────────────────────────────
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  limit,
} from 'firebase/firestore'
import { db } from '../firebase'
import { logAudit } from './firestore'
import { AUDIT } from './audit'
// The clinical fields are sealed under the MEDICAL key class — a keypair, not a
// shared secret, precisely because of the asymmetry this collection is built on:
// a member WRITES an injury report (isWriterOf, through the generic rule) and
// cannot READ one (isManagerOf, the match above it). Sealing with a symmetric
// key would have had to hand every writer the key that opens every colleague's
// record, undoing the gate this file exists to enforce. See
// src/shared/crypto/policy.js.
import { sealDoc, openDoc, openSnapshots } from '../../../shared/crypto'

/** The collection path shared/crypto/policy.js keys this collection's rules on. */
const SEALED = 'injuries'

const injuryCol = (orgId) => collection(db, 'organizations', orgId, 'injuries')
const injuryRef = (orgId, id) => doc(db, 'organizations', orgId, 'injuries', id)
const incRef = (orgId, incidentId) => doc(db, 'organizations', orgId, 'incidents', incidentId)
const injuryId = (incidentId, personId) => `${incidentId}__${personId}`

// ── What lives where ─────────────────────────────────────────────────────────

/**
 * The clinical fields. These are written to /injuries and to nowhere else — in
 * particular never onto the incident document, which has a far wider audience.
 *
 * `recordFileIds` is on the list although nothing has ever set it (injuryPayload
 * reads report.recordFileIds, which no writer produces, so the Injuries page
 * always shows "—"). It is named here so a dead field cannot quietly be revived
 * on the wrong document.
 *
 * Kept in step with MEDICAL_FIELDS in functions/lib/incidentMedical.js, which
 * strips the same fields off documents written before this split. functions/
 * deploys as its own package and cannot import from src/, so the list exists
 * twice on purpose; change one and change the other.
 */
export const MEDICAL_FIELDS = [
  'bodyParts', 'injuryType', 'medication', 'firstAidDetail', 'daysToReturnToWork', 'recordFileIds',
]

/**
 * What an incident may carry about an injured person: enough to find their
 * injury report, and nothing more.
 *
 * `personId` is the join key — the injury doc id is `${incidentId}__${personId}`.
 * `personName` exposes nothing new; the same name is already on the incident as
 * affectedPersonnel[].name. `firstAidDone` is the one judgement call: a boolean
 * "first aid was administered" beside a named person is still a health assertion
 * about them, and if the standard tightens it should move too. It stays for now
 * because it is what Step 1a uses to decide whether a detail field was ever
 * filled in, and nothing but display depends on it.
 */
export const INCIDENT_INJURY_FIELDS = ['personId', 'personName', 'firstAidDone']

/** One injury report as the incident document is allowed to hold it. */
export function incidentInjuryStub(report = {}) {
  return {
    personId: report?.personId || '',
    personName: report?.personName || '',
    firstAidDone: Boolean(report?.firstAidDone),
  }
}

/**
 * Every write of `injuryReports` onto an incident goes through this — see
 * createIncident/updateIncident in incidents.js, which route through it so the
 * contamination cannot come back by way of a caller that forgets. Applying it to
 * an array read back from Firestore also scrubs a document written before the
 * split, which is how existing incidents lose their medical fields on next save.
 */
export const incidentInjuryStubs = (reports = []) =>
  (Array.isArray(reports) ? reports : []).map(incidentInjuryStub)

/**
 * Step 1a's form value: the incident's stubs rehydrated with the clinical detail
 * from /injuries.
 *
 * A caller who cannot read that collection passes an empty list and gets the
 * stubs straight back. That is deliberate — the form must not present blanks it
 * would then save over the top of a colleague's medical record, so the wizard
 * shows those people as recorded-and-hidden rather than editable.
 */
export function mergeInjuryDetail(stubs = [], injuries = []) {
  const byPerson = new Map((injuries || []).filter((j) => j?.personId).map((j) => [j.personId, j]))
  return (stubs || []).map((stub) => {
    const detail = byPerson.get(stub?.personId)
    if (!detail) return { ...stub }
    const out = { ...stub }
    for (const k of MEDICAL_FIELDS) if (k in detail) out[k] = detail[k]
    return out
  })
}

/** Denormalized injury doc body (incident context carried for the standalone list). */
function injuryPayload(incident, report) {
  return {
    incidentId: incident.id,
    incidentRefNo: incident.refNo || '',
    personId: report.personId || '',
    personName: report.personName || '',
    firstAidDone: report.firstAidDone || false,
    firstAidDetail: report.firstAidDetail || '',
    bodyParts: report.bodyParts || [],
    injuryType: report.injuryType || '',
    medication: report.medication || '',
    daysToReturnToWork: report.daysToReturnToWork ?? '',
    recordFileIds: report.recordFileIds || [],
    // incident context (for filtering / display in the standalone page)
    incidentDate: incident.incidentDate || '',
    incidentType: incident.type || '',
    severity: incident.severity || '',
    location: incident.location || '',
    deletedAt: null,
    updatedAt: serverTimestamp(),
  }
}

/**
 * Upsert the incident's injury reports into the standalone collection, and remove
 * any prior injury docs for persons no longer present. Verification fields
 * (status/verifiedBy/verifiedAt) are intentionally omitted so re-syncing never
 * clears a completed verification — a brand-new doc simply has no status, which
 * the UI treats as "pending".
 *
 * EVERY capture path has to come through here, because this is the only writer
 * of clinical detail there is. An entry with no `personId` is skipped below, so
 * a caller that identifies people some other way records nothing — which is
 * exactly what the employee portal did for as long as it wrote its injury
 * capture straight onto the incident under `name`/`uid`.
 */
export async function syncIncidentInjuries(orgId, incident, reports = [], actor) {
  // Snapshot existing injuries for this incident so we can (a) protect VERIFIED
  // records from being overwritten and (b) clean up removed persons.
  const verified = new Set()
  let existing = []
  try {
    const snap = await getDocs(query(injuryCol(orgId), where('incidentId', '==', incident.id)))
    existing = snap.docs
    for (const d of snap.docs) if (injuryStatus(d.data()) === 'verified') verified.add(d.id)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[Incident IRA] injury snapshot skipped:', e?.message || e)
  }
  const keep = new Set()
  for (const r of reports) {
    // No key, no record: the doc id is built from it, so an entry without one
    // cannot be stored or found again. Callers must supply a personId.
    if (!r.personId) continue
    const id = injuryId(incident.id, r.personId)
    keep.add(id)
    if (verified.has(id)) continue // never overwrite a verified injury report
    await setDoc(injuryRef(orgId, id), await sealDoc(orgId, SEALED, injuryPayload(incident, r)), { merge: true })
  }
  // Cleanup: delete injury docs for this incident whose person was removed
  // (but keep verified ones for the record).
  try {
    for (const d of existing) if (!keep.has(d.id) && !verified.has(d.id)) await deleteDoc(d.ref)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[Incident IRA] injury cleanup skipped:', e?.message || e)
  }
  await logAudit(orgId, actor, AUDIT.INJURY_SYNC, {
    target: 'injury',
    targetId: incident.id,
    targetLabel: incident.refNo || incident.id,
    summary: `${reports.length} injury report(s) saved for verification`,
  })
}

export function subscribeInjuries(orgId, cb) {
  // Order by updatedAt (every write stamps it); newest first.
  const q = query(injuryCol(orgId), orderBy('updatedAt', 'desc'), limit(2000))
  // openSnapshots decrypts each batch and drops any that is no longer the
  // latest — a busy collection re-emits faster than two thousand records
  // decrypt, and without the guard an older list can land on top of a newer one.
  // `deletedAt` is filtered BEFORE decryption because it is not sealed, so
  // deleted records cost nothing to skip.
  const opened = openSnapshots(orgId, SEALED, cb)
  return onSnapshot(
    q,
    (snap) => opened(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => !x.deletedAt)),
    () => cb([]) // non-fatal: missing index / permissions → empty
  )
}

// Fields a user may edit on a pending injury report.
const EDITABLE = ['firstAidDone', 'firstAidDetail', 'bodyParts', 'injuryType', 'medication', 'daysToReturnToWork']

/**
 * Edit a pending injury report. Rejects if it's already verified. Writes the
 * changes to the standalone injury doc, and mirrors the join key — only the join
 * key — back onto the parent incident. UI-gated to reporter/investigator/admin.
 */
export async function updateInjury(orgId, id, fields, actor) {
  const snap = await getDoc(injuryRef(orgId, id))
  if (!snap.exists()) throw new Error('Injury report not found')
  // Not opened. Nothing below reads a sealed field off it — `status` and the
  // two join keys are all in the clear — and opening it here would decrypt a
  // colleague's record for an editor who may hold no key at all.
  const cur = snap.data()
  if (injuryStatus(cur) === 'verified') throw new Error('This injury report is verified and locked. Unverify it first to make changes.')
  const clean = {}
  for (const k of EDITABLE) if (k in fields) clean[k] = fields[k]
  // `joinable` is taken from the PLAINTEXT edit, below, before this seals it:
  // what goes back onto the incident is governed by the incident's own policy,
  // and a value sealed for /injuries would fail its AAD binding there anyway.
  const sealed = await sealDoc(orgId, SEALED, clean)
  await updateDoc(injuryRef(orgId, id), { ...sealed, updatedAt: serverTimestamp() })
  // Mirror the join key back onto the incident. This used to spread the whole
  // edit — `{ ...r, ...clean }` — which re-wrote body parts, injury type,
  // medication and days off onto the widely-readable incident document every
  // time anyone saved this page. Rebuilding the array through incidentInjuryStubs
  // both drops the clinical fields from this edit and scrubs any left over from
  // before the split.
  if (cur.incidentId && cur.personId) {
    const joinable = {}
    for (const k of INCIDENT_INJURY_FIELDS) if (k in clean) joinable[k] = clean[k]
    try {
      const isnap = await getDoc(incRef(orgId, cur.incidentId))
      if (isnap.exists()) {
        const reports = incidentInjuryStubs(isnap.data().injuryReports)
          .map((r) => (r.personId === cur.personId ? { ...r, ...joinable } : r))
        await updateDoc(incRef(orgId, cur.incidentId), { injuryReports: reports, updatedAt: serverTimestamp() })
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[Incident IRA] injury→incident sync skipped:', e?.message || e)
    }
  }
  // The label used to be `${cur.personName} · ${cur.incidentRefNo}`, and
  // personName is now sealed. Neither available option was to write it here:
  // the ciphertext would put an unreadable string in front of whoever reads the
  // log, and decrypting it would copy a name out of the manager-only collection
  // into /auditLogs, which is a different audience — the same "confine the
  // fields, publish the second copy" mistake this collection was split to fix.
  // The document id and the incident reference find the record and name nobody.
  await logAudit(orgId, actor, AUDIT.INJURY_UPDATE, {
    target: 'injury', targetId: id, targetLabel: cur.incidentRefNo || id, summary: 'Injury report edited',
  })
}

/** Mark an injury report verified (or revert to pending). Investigator/admin only (UI-gated). */
export async function setInjuryVerified(orgId, id, verified, actor, label) {
  await updateDoc(injuryRef(orgId, id), {
    status: verified ? 'verified' : 'pending',
    verifiedBy: verified ? actor?.uid || null : null,
    verifiedByName: verified ? actor?.name || '' : '',
    verifiedAt: verified ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  })
  await logAudit(orgId, actor, verified ? AUDIT.INJURY_VERIFY : AUDIT.INJURY_UNVERIFY, {
    target: 'injury',
    targetId: id,
    targetLabel: label || id,
    summary: verified ? 'Injury report verified' : 'Injury report verification cleared',
  })
}

/** Status helper: a doc with no explicit status is treated as pending. */
export const injuryStatus = (inj) => (inj?.status === 'verified' ? 'verified' : 'pending')
