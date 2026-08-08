// ─────────────────────────────────────────────────────────────────────────────
// CCTV inventory persistence.
//
// Three org-scoped collections, one per layer of the chain. They are kept apart
// rather than folded into one "devices" collection because the questions asked
// of them differ: a camera is asked where it points, a DVR how many channels it
// has and what it records to, a Meraki which site it carries. Merging them would
// mean a document where two thirds of the fields are always blank.
//
// No document ids here. Following the precedent set for fire equipment in
// shared/docId/format.js: a camera already carries an asset tag identifying the
// physical thing that was bought, and a generated number would give two answers
// to "which camera is this".
// ─────────────────────────────────────────────────────────────────────────────

import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../../shared/firebase'
import { logAudit } from '../../../shared/org/orgData'

export const COLLECTIONS = {
  cameras: 'cctvCameras',
  dvrs: 'cctvDvrs',
  merakis: 'cctvMeraki',
}

const col = (orgId, name) => collection(db, 'organizations', orgId, name)
const ref = (orgId, name, id) => doc(db, 'organizations', orgId, name, id)

/** Live list, newest names first. Returns the unsubscribe. */
function subscribe(orgId, name, cb) {
  if (!orgId) return () => {}
  // orderBy('name') rather than a timestamp: these are read as an equipment
  // register, where people scan for a device by its label, not by when it was
  // added. Documents missing the field are dropped by Firestore's ordering, so
  // every writer below always sets it.
  const q = query(col(orgId, name), orderBy('name'))
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    // A listener that dies silently leaves the page showing an empty estate,
    // which reads as "no cameras" rather than "not loaded".
    (err) => {
      // eslint-disable-next-line no-console
      console.error(`[CCTV] ${name} listener failed:`, err?.message || err)
      cb(null, err)
    }
  )
}

export const subscribeCameras = (orgId, cb) => subscribe(orgId, COLLECTIONS.cameras, cb)
export const subscribeDvrs = (orgId, cb) => subscribe(orgId, COLLECTIONS.dvrs, cb)
export const subscribeMerakis = (orgId, cb) => subscribe(orgId, COLLECTIONS.merakis, cb)

// ── Shape normalisation ──────────────────────────────────────────────────────
// Firestore rejects `undefined`, and a half-filled form produces plenty of it.
// Every writer runs its input through one of these so a missing optional field
// becomes '' rather than an exception halfway through a bulk import.

const str = (v) => String(v ?? '').trim()
const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : [])

const cameraShape = (d) => ({
  name: str(d.name),
  location: str(d.location),
  dvrId: str(d.dvrId),
  siteId: str(d.siteId),
  siteName: str(d.siteName),
  status: str(d.status) || 'unknown',
  defects: list(d.defects).filter((x) => x !== 'offline'), // derived, never stored
  make: str(d.make),
  model: str(d.model),
  channel: str(d.channel),
  notes: str(d.notes),
})

const dvrShape = (d) => ({
  name: str(d.name),
  ipAddress: str(d.ipAddress),
  siteId: str(d.siteId),
  siteName: str(d.siteName),
  status: str(d.status) || 'unknown',
  defects: list(d.defects).filter((x) => x !== 'offline'),
  channels: Number(d.channels) || 0,
  make: str(d.make),
  model: str(d.model),
  location: str(d.location),
  notes: str(d.notes),
})

const merakiShape = (d) => ({
  name: str(d.name),
  ipAddress: str(d.ipAddress),
  siteId: str(d.siteId),
  siteName: str(d.siteName),
  status: str(d.status) || 'unknown',
  defects: list(d.defects).filter((x) => x !== 'offline'),
  model: str(d.model),
  serial: str(d.serial),
  notes: str(d.notes),
})

const SHAPES = {
  [COLLECTIONS.cameras]: cameraShape,
  [COLLECTIONS.dvrs]: dvrShape,
  [COLLECTIONS.merakis]: merakiShape,
}

const LABELS = {
  [COLLECTIONS.cameras]: 'camera',
  [COLLECTIONS.dvrs]: 'DVR',
  [COLLECTIONS.merakis]: 'Meraki device',
}

// ── Writes ───────────────────────────────────────────────────────────────────

async function create(orgId, name, data, actor) {
  const payload = SHAPES[name](data)
  if (!payload.name) throw new Error(`Give the ${LABELS[name]} a name`)
  const created = await addDoc(col(orgId, name), {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await logAudit(orgId, actor, 'cctv.create', {
    target: name, targetId: created.id, targetLabel: payload.name,
    summary: `Added ${LABELS[name]} ${payload.name}`,
  })
  return created.id
}

async function update(orgId, name, id, data, actor) {
  const payload = SHAPES[name](data)
  await updateDoc(ref(orgId, name, id), { ...payload, updatedAt: serverTimestamp() })
  await logAudit(orgId, actor, 'cctv.update', {
    target: name, targetId: id, targetLabel: payload.name,
    summary: `Updated ${LABELS[name]} ${payload.name}`,
  })
}

async function remove(orgId, name, id, label, actor) {
  await deleteDoc(ref(orgId, name, id))
  await logAudit(orgId, actor, 'cctv.delete', {
    target: name, targetId: id, targetLabel: label,
    summary: `Removed ${LABELS[name]} ${label}`,
  })
}

export const addCamera = (orgId, d, actor) => create(orgId, COLLECTIONS.cameras, d, actor)
export const updateCamera = (orgId, id, d, actor) => update(orgId, COLLECTIONS.cameras, id, d, actor)
export const deleteCamera = (orgId, id, label, actor) => remove(orgId, COLLECTIONS.cameras, id, label, actor)

export const addDvr = (orgId, d, actor) => create(orgId, COLLECTIONS.dvrs, d, actor)
export const updateDvr = (orgId, id, d, actor) => update(orgId, COLLECTIONS.dvrs, id, d, actor)
export const deleteDvr = (orgId, id, label, actor) => remove(orgId, COLLECTIONS.dvrs, id, label, actor)

export const addMeraki = (orgId, d, actor) => create(orgId, COLLECTIONS.merakis, d, actor)
export const updateMeraki = (orgId, id, d, actor) => update(orgId, COLLECTIONS.merakis, id, d, actor)
export const deleteMeraki = (orgId, id, label, actor) => remove(orgId, COLLECTIONS.merakis, id, label, actor)

/**
 * Set a device's reported status — the one field a monitoring integration would
 * write, kept separate from the full update so a status poll cannot clobber the
 * inventory fields a person maintains by hand.
 */
export async function setStatus(orgId, kind, id, status, actor, label) {
  const name = COLLECTIONS[kind]
  if (!name) throw new Error(`Unknown device kind ${kind}`)
  await updateDoc(ref(orgId, name, id), {
    status: str(status) || 'unknown',
    statusAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await logAudit(orgId, actor, 'cctv.status', {
    target: name, targetId: id, targetLabel: label || id,
    summary: `${LABELS[name]} ${label || id} marked ${status}`,
  })
}

/**
 * Raise or clear the observed defects on a device.
 *
 * `offline` is stripped: it is derived from connectivity in health.js, and
 * letting it be stored is how a streaming camera ends up flagged offline
 * forever because someone ticked a box once.
 */
export async function setDefects(orgId, kind, id, defects, actor, label) {
  const name = COLLECTIONS[kind]
  if (!name) throw new Error(`Unknown device kind ${kind}`)
  const clean = list(defects).filter((x) => x !== 'offline')
  await updateDoc(ref(orgId, name, id), { defects: clean, updatedAt: serverTimestamp() })
  await logAudit(orgId, actor, 'cctv.defects', {
    target: name, targetId: id, targetLabel: label || id,
    summary: clean.length
      ? `${LABELS[name]} ${label || id}: ${clean.join(', ')}`
      : `${LABELS[name]} ${label || id}: defects cleared`,
  })
}
