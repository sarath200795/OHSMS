// ─────────────────────────────────────────────────────────────────────────────
// Shared data-access base: organizations, users, the public org-name index, the
// append-only audit log, and sites. Every module builds on top of these helpers
// and the org-scoped collection factory (moduleCol) so tenant scoping is
// automatic and consistent.
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
} from 'firebase/firestore'
import { db } from '../firebase'
import { isSessionEnd } from '../sessionEnd'
import { AUDIT } from '../audit/audit'
import { createSharedSubscription } from './sharedSubscription'
import { notifySiteCreated } from './siteHooks'

// ── Path helpers ──────────────────────────────────────────────────────────────
export const orgRef = (orgId) => doc(db, 'organizations', orgId)
export const userRef = (uid) => doc(db, 'users', uid)
export const auditCol = (orgId) => collection(db, 'organizations', orgId, 'auditLogs')

/**
 * Org-scoped collection factory — THE way modules reach their data. Guarantees
 * every read/write is namespaced under /organizations/{orgId}/<name>, which is
 * what the security rules enforce for tenant isolation.
 */
export const moduleCol = (orgId, name) => collection(db, 'organizations', orgId, name)
export const moduleDoc = (orgId, name, id) => doc(db, 'organizations', orgId, name, id)

// Public, minimal name→org index so signup can resolve an org by name WITHOUT
// read access to the member-only organizations collection.
// Exported because five module service layers each carried a byte-identical
// private copy of this pair. One name-to-key rule, in one place.
export const orgIndexKey = (name) => (name || '').trim().toLowerCase()
export const orgIndexRef = (name) => doc(db, 'orgIndex', orgIndexKey(name))

// ── Audit log ───────────────────────────────────────────────────────────────
// Append-only trail. Never let an audit failure break the primary write.
export async function logAudit(orgId, actor, action, details = {}) {
  if (!orgId) return
  try {
    await addDoc(auditCol(orgId), {
      at: serverTimestamp(),
      actorUid: actor?.uid || null,
      actorName: actor?.name || actor?.displayName || 'Unknown',
      action,
      module: details.module || 'core',
      target: details.target || 'record',
      targetId: details.targetId || null,
      targetLabel: details.targetLabel || '',
      summary: details.summary || '',
      source: details.source || 'portal',
    })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[OHS MS] audit log failed:', e?.message || e)
  }
}

/**
 * Fetch the trail for a DATE RANGE, rather than the newest N.
 *
 * The viewer subscribed to the 400 most recent entries and offered no way to
 * ask for a period, so "what happened to this permit in March" became
 * unanswerable the moment 400 events had accrued — days, in a busy tenant.
 * Evidence that cannot be retrieved is not evidence, and an append-only trail
 * nobody can read back is a write-only file.
 *
 * A one-shot read rather than a listener: collecting evidence is a question
 * asked once, and a live subscription over a wide range would stream the whole
 * period into memory and then keep it there.
 *
 * The `to` bound covers the whole day it names. Somebody asking for the 31st
 * means the 31st, not the instant it began.
 */
export async function fetchAuditLogs(orgId, { from = '', to = '', max = 5000 } = {}) {
  if (!orgId) return []
  const clauses = [orderBy('at', 'desc'), limit(max)]
  if (from) clauses.unshift(where('at', '>=', new Date(from + 'T00:00:00')))
  if (to) clauses.unshift(where('at', '<=', new Date(to + 'T23:59:59.999')))
  const snap = await getDocs(query(auditCol(orgId), ...clauses))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export function subscribeAuditLogs(orgId, cb, max = 300) {
  const q = query(auditCol(orgId), orderBy('at', 'desc'), limit(max))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
}

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
    notificationEmail: email,
    createdAt: serverTimestamp(),
  })
  batch.set(userRef(uid), {
    name,
    email,
    orgId: org.id,
    orgName,
    role: 'admin',
    status: 'approved',
    dept: '',
    createdAt: serverTimestamp(),
  })
  // Public lookup index (no sensitive fields).
  batch.set(orgIndexRef(orgName), { orgId: org.id, name: orgName })
  await batch.commit()
  return org.id
}

/** Find an organization by exact (case-insensitive) name via the public orgIndex. */
export async function findOrgByName(orgName) {
  const snap = await getDoc(orgIndexRef(orgName))
  if (!snap.exists()) return null
  const d = snap.data()
  return { id: d.orgId, name: d.name }
}

/** List every organization (public orgIndex) as [{ id, name }] sorted by name. */
export async function listOrganizations() {
  const snap = await getDocs(collection(db, 'orgIndex'))
  return snap.docs
    .map((d) => ({ id: d.data().orgId, name: d.data().name }))
    .filter((o) => o.id && o.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Create a pending member joining an existing org (defaults to a standard member). */
export async function createPendingMember({ uid, name, email, orgId, orgName, department }) {
  await setDoc(userRef(uid), {
    name,
    email,
    orgId,
    orgName,
    role: 'member',
    status: 'pending',
    dept: '',
    department: department || '',
    access: { sites: [], regions: [], entities: [] },
    accessRequest: null,
    createdAt: serverTimestamp(),
  })
}

export async function getUserProfile(uid) {
  const snap = await getDoc(userRef(uid))
  return snap.exists() ? { uid, ...snap.data() } : null
}

// ── Shared org-collection listeners ─────────────────────────────────────────
// The same collections are read by several modules at once (incidents, fas,
// extinguishers, auditFindings…). Multiplexing them over ONE listener per
// collection keeps document reads and open sockets flat as concurrency grows,
// instead of scaling with (users × modules mounted).
// Capped and status-carrying for the same reasons as subscribeCollections
// below — this one feeds the Action Tracker, whose totals are read the same way
// analytics' are. It was the last uncapped read in the app, and it had the same
// two faults: no ceiling, and an error path that emitted an empty array so a
// permission failure looked like "no outstanding actions", which on a safety
// system is the most dangerous possible way to be wrong.
const sharedOrgCollection = createSharedSubscription((key, emit) => {
  const [orgId, name] = key.split('/')
  return onSnapshot(
    query(collection(db, 'organizations', orgId, name), limit(COLLECTION_READ_CAP)),
    (snap) => emit({
      rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
      status: snap.size >= COLLECTION_READ_CAP ? 'capped' : 'ok',
    }),
    (err) => {
      if (!isSessionEnd(name, err)) {
        // eslint-disable-next-line no-console
        console.warn(`[OHS MS] ${name} read failed:`, err?.message || err)
      }
      emit({ rows: [], status: 'failed' })
    }
  )
})

/**
 * Live rows of any org sub-collection, shared app-wide.
 *
 * Emits `{ rows, status }`, never a bare array — the same reasoning as
 * subscribeCollections: a caller that can reach the rows is holding the reason
 * they may be short. status is 'ok' | 'capped' | 'failed'.
 */
export function subscribeOrgCollection(orgId, name, cb) {
  return sharedOrgCollection(`${orgId}/${name}`, cb)
}

// ONE org-users listener shared by every module context.
const sharedOrgUsers = createSharedSubscription((orgId, emit) =>
  onSnapshot(
    query(collection(db, 'users'), where('orgId', '==', orgId)),
    (snap) => emit(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))),
    () => emit([])
  )
)
export function subscribeOrgUsers(orgId, cb) {
  return sharedOrgUsers(orgId, cb)
}

/** Live org document. */
export function subscribeOrg(orgId, cb) {
  return onSnapshot(orgRef(orgId), (snap) =>
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null)
  )
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

// ── Sites (shared across modules) ───────────────────────────────────────────
// Same multiplexing as users — the site registry is read by nearly every module.
const sharedSites = createSharedSubscription((orgId, emit) => {
  const q = query(moduleCol(orgId, 'sites'), orderBy('name'))
  return onSnapshot(
    q,
    (snap) => emit(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      // Still an empty array, because ~20 callers destructure it as one and
      // changing that shape here is a bigger change than this deserves. But it
      // is no longer SILENT: a failed sites read renders as "No sites you can
      // access yet" on every site picker in the app, which reads as a
      // configuration problem and sends people off to create sites that
      // already exist.
      //
      // Note also the orderBy('name') above: Firestore drops documents missing
      // the ordered field, so a site saved without a name is invisible here
      // while existing perfectly well in the database.
      //
      // A permission-denied while nobody is signed in is a session ENDING, not
      // a fault: this listener is shared app-wide, so one component unmounting
      // does not close it, and it can outlive auth by a moment on sign-out or a
      // token refresh. See isSessionEnd — every live listener in the app now
      // makes the same distinction this one did.
      if (!isSessionEnd('sites', err)) {
        // eslint-disable-next-line no-console
        console.error('[OHS MS] sites read failed — every site picker will look empty:', err?.message || err)
      }
      emit([])
    }
  )
})
export function subscribeSites(orgId, cb) {
  return sharedSites(orgId, cb)
}

// Keep only non-empty string custom attributes (Building, Floor, …).
export function cleanAttributes(attributes) {
  const out = {}
  if (attributes && typeof attributes === 'object') {
    for (const [k, v] of Object.entries(attributes)) {
      const val = (v ?? '').toString().trim()
      if (k && val) out[k] = val
    }
  }
  return out
}

// Normalize a site payload (shared by create + update).
function siteFields(data) {
  const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v))
  return {
    name: data.name || '',
    // ── The site's id in whatever system of record owns it ───────────────────
    //
    // A warehouse, a property register or an ERP identifies a site by ITS key —
    // a centre service id, a store number — and that is never this app's
    // Firestore document id. Without somewhere to put that key, joining an
    // external dataset to this register falls back to matching on NAME, which
    // loses a slice of any large estate to spelling and renames.
    //
    // A STRING, deliberately, even when it looks like a number: leading zeros
    // are meaningful in store codes, and 0071 must not be stored as 71 and then
    // fail to match. Trimmed, because a trailing space pasted from a
    // spreadsheet is an invisible reason for a join to miss.
    code: String(data.code ?? '').trim(),
    region: data.region || '',
    entity: data.entity || '',
    address: data.address || '',
    lat: num(data.lat),
    lng: num(data.lng),
    firstAidBoxes: num(data.firstAidBoxes) || 0,
    attributes: cleanAttributes(data.attributes),
  }
}

export async function createSite(orgId, data, actor) {
  const fields = siteFields(data)
  const ref = await addDoc(moduleCol(orgId, 'sites'), {
    ...fields,
    createdAt: serverTimestamp(),
  })
  await logAudit(orgId, actor, AUDIT.SITE_CREATE, {
    target: 'site',
    targetId: ref.id,
    targetLabel: data.name,
    summary: `Created site "${data.name}"`,
  })
  // Modules that need something to exist per site (CCTV's Meraki, today) react
  // here. Deliberately not awaited for its result and it cannot throw — the
  // site is already written, and a failed hook must not report the creation as
  // failed. See siteHooks.js.
  await notifySiteCreated(orgId, [{ id: ref.id, ...fields }], actor)
  return ref.id
}

/**
 * Bulk-create sites from parsed rows in one batch. Callers must pre-validate
 * (every row needs a name + numeric lat/lng); this writes what it's given.
 */
export async function bulkCreateSites(orgId, rows, actor) {
  const names = []
  const created = []
  // Firestore limits a single writeBatch to 500 operations. Chunk into slices
  // of 400 (matching deleteSites) so large CSV imports don't fail outright.
  for (let i = 0; i < rows.length; i += 400) {
    const batch = writeBatch(db)
    rows.slice(i, i + 400).forEach((r) => {
      const ref = doc(moduleCol(orgId, 'sites'))
      const fields = siteFields(r)
      batch.set(ref, { ...fields, createdAt: serverTimestamp() })
      names.push(r.name)
      created.push({ id: ref.id, ...fields })
    })
    await batch.commit()
  }
  await logAudit(orgId, actor, AUDIT.SITE_CREATE, {
    target: 'site',
    summary: `Bulk imported ${names.length} site(s): ${names.slice(0, 6).join(', ')}${names.length > 6 ? '…' : ''}`,
  })
  // The import path needs the hooks as much as the single-site one: fifty sites
  // added at once would otherwise be fifty sites with no Meraki, which is the
  // case where the health cascade is most obviously wrong.
  await notifySiteCreated(orgId, created, actor)
  return names.length
}

/**
 * Apply a CSV import: update the sites the file matched, create the rest.
 *
 * `updates` are `{ id, payload, name }` — the payload already narrowed to the
 * columns the file carried, by updatePayload in parseSitesCsv.js. Nothing is
 * normalised through siteFields here, and that is the point: siteFields fills
 * in every field it knows about, so putting an update through it would write an
 * empty region over a real one whenever the spreadsheet had no region column.
 *
 * Updates go first. If the batch fails halfway, a register with some rows
 * updated is recoverable by importing the same file again; one with duplicates
 * already inserted has to be cleaned up by hand first.
 *
 * Two audit entries, not one per site: an import of four hundred rows would
 * otherwise bury every other entry in the trail for that day.
 */
export async function bulkUpsertSites(orgId, { creates = [], updates = [] }, actor) {
  for (let i = 0; i < updates.length; i += 400) {
    const batch = writeBatch(db)
    for (const u of updates.slice(i, i + 400)) {
      batch.update(moduleDoc(orgId, 'sites', u.id), u.payload)
    }
    await batch.commit()
  }
  if (updates.length) {
    const names = updates.map((u) => u.name)
    await logAudit(orgId, actor, AUDIT.SITE_UPDATE, {
      target: 'site',
      summary: `CSV import updated ${names.length} existing site(s): ${names.slice(0, 6).join(', ')}${names.length > 6 ? '…' : ''}`,
    })
  }

  // Reuses the create path wholesale, so imported sites get the same audit
  // entry and the same per-site hooks a manually added one does.
  const created = creates.length ? await bulkCreateSites(orgId, creates, actor) : 0
  return { created, updated: updates.length }
}

// ── Site-scoped access / permissions ────────────────────────────────────────
const cleanScope = (scope = {}) => ({
  sites: Array.isArray(scope.sites) ? scope.sites : [],
  regions: Array.isArray(scope.regions) ? scope.regions : [],
  entities: Array.isArray(scope.entities) ? scope.entities : [],
})

/** Admin sets a user's department + granted access scope (and clears any request). */
export async function setUserAccess(uid, { department, access }, orgId, actor, userLabel) {
  await updateDoc(userRef(uid), {
    department: department || '',
    access: cleanScope(access),
    accessRequest: null,
  })
  await logAudit(orgId, actor, AUDIT.USER_ROLE, {
    target: 'user',
    targetId: uid,
    targetLabel: userLabel || uid,
    summary: `Granted site access${department ? ` · ${department}` : ''}`,
  })
}

/** A user submits an access request (department + desired scope) for admin review. */
export async function requestAccess(uid, { department, scope }, orgId, actor) {
  await updateDoc(userRef(uid), {
    department: department || '',
    accessRequest: { ...cleanScope(scope), at: serverTimestamp(), by: actor?.name || '' },
  })
  await logAudit(orgId, actor, AUDIT.USER_STATUS, {
    target: 'user',
    targetId: uid,
    targetLabel: actor?.name || uid,
    summary: 'Requested site access',
  })
}

/** Admin applies a user's pending request → grant, then clears the request. */
export async function grantAccessRequest(uid, request, orgId, actor, userLabel) {
  await updateDoc(userRef(uid), {
    access: cleanScope(request),
    accessRequest: null,
  })
  await logAudit(orgId, actor, AUDIT.USER_ROLE, {
    target: 'user',
    targetId: uid,
    targetLabel: userLabel || uid,
    summary: 'Granted requested site access',
  })
}

// ── Capped multi-collection reads ───────────────────────────────────────────
// The screens that roll several modules up at once (analytics, portal home, the
// site summary) read whole collections. Unbounded, that grows with the age of
// the tenant: one analytics visit used to stream every incident, drill, camera
// and legal issue ever recorded, and both the bill and the tab's memory grew
// forever.
//
// 5 000 documents per collection is the ceiling. It is deliberately far above
// what these collections hold in practice — a fifty-site tenant logging ten
// incidents a site a month takes eight years to reach it — so a cap that hides
// records is the rare case, not the normal one. It also bounds the worst case:
// the eleven listeners analytics opens can pull 55 000 documents and no more.
// VITE_TEST_READ_CAP lowers the ceiling so e2e/capped-reads.spec.js can prove
// that every screen totalling a capped register actually renders the notice.
// There is no other way to check that wiring: at 5 000 no fixture can trip it,
// and "the notice exists and is unit tested" is not the same claim as "the page
// asks for it". Unset in every real environment, so production reads 5 000.
export const COLLECTION_READ_CAP = Number(import.meta.env?.VITE_TEST_READ_CAP) || 5000

// Used in the "your numbers are short" sentence, so these read as the thing the
// user sees on screen rather than as the Firestore path.
const COLLECTION_LABEL = {
  incidents: 'incidents',
  mockDrills: 'mock drills',
  consultations: 'committee meetings',
  extinguishers: 'fire extinguishers',
  aeds: 'AEDs',
  fas: 'fire alarm devices',
  signages: 'safety signage',
  permits: 'permits to work',
  observations: 'permit observations',
  cctvCameras: 'CCTV cameras',
  cctvDvrs: 'CCTV recorders',
  cctvMeraki: 'Meraki devices',
  escalations: 'escalations',
  legalIssues: 'legal issues',
}

const groupDigits = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

function joinLabels(names) {
  const labels = names.map((n) => COLLECTION_LABEL[n] || n)
  if (labels.length < 2) return labels[0] || ''
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

/**
 * Turn per-collection read status into the sentence a screen must show, or null
 * when every collection came back whole.
 *
 * `status` maps collection name → 'ok' | 'capped' | 'failed'. Kept pure and
 * exported so the wording is the same on every screen and can be tested.
 */
export function incompleteReadNotice(status, cap = COLLECTION_READ_CAP) {
  const names = Object.keys(status || {})
  const capped = names.filter((n) => status[n] === 'capped')
  const failed = names.filter((n) => status[n] === 'failed')
  if (!capped.length && !failed.length) return null
  const parts = []
  if (capped.length) {
    parts.push(`Only the first ${groupDigits(cap)} records were loaded for ${joinLabels(capped)}.`)
  }
  if (failed.length) parts.push(`${joinLabels(failed)} could not be loaded at all.`)
  parts.push('Any total that counts them is lower than the real figure, so these numbers must not be quoted as a count.')
  return { capped, failed, cap, message: parts.join(' ') }
}

/** The state a screen starts in, before any snapshot has arrived. */
export function emptyCollections(names = []) {
  return { data: Object.fromEntries(names.map((n) => [n, []])), incomplete: null }
}

/**
 * Live rows for a set of org-scoped collections, capped and honest about it.
 *
 * The callback gets the whole set in one object — `{ data, incomplete }` — not
 * an array per collection. That shape is the point: these rows are counted and
 * the counts end up in regulatory reports, so a caller that can reach the rows
 * is holding, in the same object, the reason they might be short. There is no
 * way to take the list and leave the warning behind.
 *
 * `incomplete` is null while everything is whole; otherwise it carries the
 * message to put on screen (see incompleteReadNotice).
 *
 * No orderBy, so no composite index is ever needed — the cap keeps the first
 * 5 000 by document ID, which is an arbitrary 5 000, but which 5 000 only
 * matters once the notice is already up.
 */
export function subscribeCollections(orgId, names, cb) {
  const data = Object.fromEntries(names.map((n) => [n, []]))
  const status = Object.fromEntries(names.map((n) => [n, 'ok']))
  const emit = () => cb({ data: { ...data }, incomplete: incompleteReadNotice(status) })

  const unsubs = names.map((name) =>
    onSnapshot(
      query(moduleCol(orgId, name), limit(COLLECTION_READ_CAP)),
      (snap) => {
        data[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        // A snapshot that exactly fills the cap is the only signal Firestore
        // gives that more is behind it. A collection holding precisely 5 000
        // rows is reported as capped when it is not — over-warning is the
        // harmless direction here.
        status[name] = snap.size >= COLLECTION_READ_CAP ? 'capped' : 'ok'
        emit()
      },
      (err) => {
        // A read that failed is not an empty collection. Reporting [] here is
        // how a permission error used to render as a confident zero.
        if (!isSessionEnd(name, err)) {
          // eslint-disable-next-line no-console
          console.warn(`[OHS MS] ${name} read failed:`, err?.message || err)
        }
        data[name] = []
        status[name] = 'failed'
        emit()
      }
    )
  )
  return () => unsubs.forEach((u) => u && u())
}

export async function updateSite(orgId, id, updates, actor) {
  await updateDoc(moduleDoc(orgId, 'sites', id), updates)
  await logAudit(orgId, actor, AUDIT.SITE_UPDATE, { target: 'site', targetId: id })
}

export async function deleteSite(orgId, id, actor, label) {
  await deleteDoc(moduleDoc(orgId, 'sites', id))
  await logAudit(orgId, actor, AUDIT.SITE_DELETE, {
    target: 'site',
    targetId: id,
    targetLabel: label,
  })
}

/**
 * Delete several sites at once, chunked to stay inside Firestore's 500-op batch
 * limit. Records already logged against a site (incidents, equipment, contacts…)
 * are NOT touched — they keep their stored site name, so history stays readable.
 * One audit entry names every site removed.
 */
export async function deleteSites(orgId, sites, actor) {
  const list = sites.filter(Boolean)
  for (let i = 0; i < list.length; i += 400) {
    const batch = writeBatch(db)
    for (const s of list.slice(i, i + 400)) batch.delete(moduleDoc(orgId, 'sites', s.id))
    await batch.commit()
  }
  await logAudit(orgId, actor, AUDIT.SITE_DELETE, {
    target: 'site',
    targetLabel: `${list.length} sites`,
    summary: `Deleted ${list.length} site(s): ${list.map((s) => s.name).join(', ').slice(0, 500)}`,
  })
  return list.length
}
