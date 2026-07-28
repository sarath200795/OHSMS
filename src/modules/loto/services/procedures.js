import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { PROCEDURE_STATUS, computeLockSummary } from '../constants/procedures'

const COL = 'procedures'
const PHOTOS = 'procedurePhotos'
const EVENTS = 'lotoEvents'

/** Pre-generate a procedure document id so a draft can be referenced early. */
export function newProcedureId() {
  return doc(collection(db, COL)).id
}

// Strip transient/photo fields off isolation points before persisting the main
// doc; photos live in a separate (heavier) document so dashboards stay light.
function sanitizePoints(points = []) {
  return points.map(({ photo, ...p }) => ({ ...p, hasPhoto: Boolean(photo || p.hasPhoto) }))
}

/** Create a brand-new procedure (status: draft) + its photos doc. */
export async function createProcedure(id, data, user, photos = {}) {
  const points = sanitizePoints(data.isolationPoints || [])
  const batch = writeBatch(db)
  batch.set(doc(db, COL, id), {
    ...data,
    isolationPoints: points,
    revision: 0,
    status: PROCEDURE_STATUS.DRAFT,
    lockSummary: computeLockSummary(points),
    createdBy: user.id,
    createdByName: user.displayName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    approvedBy: null,
    approvedByName: null,
    approvedAt: null,
  })
  batch.set(doc(db, PHOTOS, id), {
    orgId: data.orgId,
    photos: photos || {},
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
  return id
}

/** Save a revision: bumps revision, resets to draft, replaces photos. */
export async function reviseProcedure(id, data, user, photos = {}) {
  const snap = await getDoc(doc(db, COL, id))
  const current = snap.data() || {}
  const points = sanitizePoints(data.isolationPoints || [])
  const batch = writeBatch(db)
  batch.update(doc(db, COL, id), {
    ...data,
    isolationPoints: points,
    revision: (current.revision ?? 0) + 1,
    status: PROCEDURE_STATUS.DRAFT,
    lockSummary: computeLockSummary(points),
    revisedBy: user.id,
    revisedByName: user.displayName,
    updatedAt: serverTimestamp(),
    approvedBy: null,
    approvedByName: null,
    approvedAt: null,
  })
  batch.set(doc(db, PHOTOS, id), {
    orgId: data.orgId,
    photos: photos || {},
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
}

export async function deleteProcedure(procedure) {
  const batch = writeBatch(db)
  batch.delete(doc(db, COL, procedure.id))
  batch.delete(doc(db, PHOTOS, procedure.id))
  await batch.commit()
}

/** Photos map { [pointKey]: dataUrl } for a procedure (empty object if none). */
export async function getProcedurePhotos(id) {
  try {
    const snap = await getDoc(doc(db, PHOTOS, id))
    return snap.exists() ? snap.data().photos || {} : {}
  } catch {
    return {}
  }
}

export async function sendForApproval(id) {
  await updateDoc(doc(db, COL, id), {
    status: PROCEDURE_STATUS.PENDING_APPROVAL,
    updatedAt: serverTimestamp(),
  })
}

export async function approveProcedure(id, user) {
  await updateDoc(doc(db, COL, id), {
    status: PROCEDURE_STATUS.APPROVED,
    approvedBy: user.id,
    approvedByName: user.displayName,
    approvedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function rejectProcedure(id) {
  await updateDoc(doc(db, COL, id), {
    status: PROCEDURE_STATUS.REJECTED,
    updatedAt: serverTimestamp(),
  })
}

/**
 * Lock or unlock a single isolation point. Records who/when for both apply and
 * remove, keeps the last lock time, and appends to a capped audit history.
 * Runs in a transaction to avoid lost updates.
 */
export async function setPointLock(procedureId, pointKey, locked, user, tech = null) {
  const ref = doc(db, COL, procedureId)
  const eventRef = doc(collection(db, EVENTS))
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Procedure not found')
    const data = snap.data()
    if (data.status !== PROCEDURE_STATUS.APPROVED) {
      throw new Error('Procedure must be approved before performing LOTO')
    }
    // Primary technician: required when locking; reuse the procedure's primary
    // once set so the whole lockout is attributed to one technician.
    // Each point gets its own lock (no reuse of a single primary lock).
    const useTech = locked ? tech : null
    if (locked && !useTech) throw new Error('Select a technician to apply the lock')
    // Removal order: every group-lock technician must be removed before the
    // primary point lock can come off.
    if (
      !locked &&
      data.groupLock?.active &&
      (data.groupLock.members?.length || 0) > 0
    ) {
      throw new Error('Remove all group-lock technicians before removing the primary lock')
    }
    // Multiple isolation points require a Department lock.
    if (
      locked &&
      (data.isolationPoints || []).length > 1 &&
      useTech?.lockType !== 'department'
    ) {
      throw new Error('Multiple isolation points require a Department lock')
    }
    // Lock number must be unique: not already on another locked point, and not
    // held by a group-lock member anywhere in this procedure.
    if (locked && useTech?.lockNo) {
      const dupPoint = (data.isolationPoints || []).find(
        (p) => p.key !== pointKey && p.lockState?.locked && p.lockState.techLockNo === useTech.lockNo,
      )
      const dupGroup = (data.groupLock?.members || []).some((m) =>
        Object.values(m.locks || {}).includes(useTech.lockNo),
      )
      if (dupPoint || dupGroup) {
        throw new Error(`Lock ${useTech.lockNo} is already in use on this equipment`)
      }
    }

    const at = new Date().toISOString()
    let target = null
    const points = (data.isolationPoints || []).map((p) => {
      if (p.key !== pointKey) return p
      const prev = p.lockState || {}
      const lockState = locked
        ? {
            locked: true,
            lockedBy: user.id,
            lockedByName: user.displayName,
            lockedAt: at,
            techId: useTech?.techId || null,
            techName: useTech?.name || null,
            techLockNo: useTech?.lockNo || null,
            lockType: useTech?.lockType || null,
            unlockedBy: null,
            unlockedByName: null,
            unlockedAt: null,
          }
        : {
            locked: false,
            lockedBy: prev.lockedBy || null,
            lockedByName: prev.lockedByName || null,
            lockedAt: prev.lockedAt || null,
            techId: prev.techId || null,
            techName: prev.techName || null,
            techLockNo: prev.techLockNo || null,
            lockType: prev.lockType || null,
            unlockedBy: user.id,
            unlockedByName: user.displayName,
            unlockedAt: at,
          }
      target = { ...p, lockState }
      return target
    })

    const summary = computeLockSummary(points, data.groupLock)
    const update = {
      isolationPoints: points,
      lockSummary: summary,
      updatedAt: serverTimestamp(),
    }
    if (locked) {
      // Lead technician label only (first lock); not reused to apply locks.
      if (!data.primaryTech) update.primaryTech = useTech
    } else if (summary.lockedCount === 0) {
      // Fully unlocked → clear the lockout (primary + group lock).
      update.primaryTech = null
      update.groupLock = { active: false, method: null, members: [] }
    }
    tx.update(ref, update)

    tx.set(eventRef, {
      orgId: data.orgId,
      procedureId,
      equipment: data.equipment || '',
      site: data.site || '',
      procedureCode: data.procedureCode || '',
      pointKey,
      pointId: target?.pointId || '',
      energy: target?.energyLabel || target?.energySource || '',
      action: locked ? 'lock' : 'unlock',
      techName: useTech?.name || null,
      by: user.id,
      byName: user.displayName,
      at: serverTimestamp(),
    })
  })
}

/**
 * Add an additional technician to a group lockout (equipment must be fully
 * locked). Two methods:
 *  - Group LOTO Box: the technician applies ONE personal padlock to the box —
 *    `member.boxLock = lockNo` (their dedicated lock).
 *  - Hasp: the technician applies a UNIQUE Department lock to every locked
 *    isolation point — `member.locks = { [pointKey]: lockNo }`.
 * `swaps = { [pointKey]: lockNo }` converts any personal primary lock to a
 * department lock (single-point case), freeing the personal lock.
 */
export async function addGroupMember(procedureId, member, method, user, swaps = {}) {
  const ref = doc(db, COL, procedureId)
  const eventRef = doc(collection(db, EVENTS))
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Procedure not found')
    const data = snap.data()
    if (data.lockSummary?.status !== 'locked') {
      throw new Error('Equipment must be fully locked before adding group locks')
    }
    const group = data.groupLock?.active
      ? data.groupLock
      : { active: true, method, members: [] }
    if (group.members.some((m) => m.techId === member.techId)) {
      throw new Error('That technician is already on the group lock')
    }

    const update = { updatedAt: serverTimestamp() }
    let points = data.isolationPoints || []
    let primaryTech = data.primaryTech || null

    // Personal → department swaps on the named points (single-point case).
    if (swaps && Object.keys(swaps).length) {
      points = points.map((p) =>
        p.lockState?.locked && swaps[p.key]
          ? {
              ...p,
              lockState: { ...p.lockState, techLockNo: swaps[p.key], lockType: 'department' },
            }
          : p,
      )
      update.isolationPoints = points
      const swapVals = Object.values(swaps)
      if (swapVals.length && primaryTech?.lockType === 'personal') {
        primaryTech = { ...primaryTech, lockNo: swapVals[0], lockType: 'department' }
        update.primaryTech = primaryTech
      }
    }

    const effectiveMethod = group.method || method
    const lockedPoints = points.filter((p) => p.lockState?.locked)

    // All lock numbers already committed on this equipment (point locks + any
    // existing group members' box/per-point locks).
    const used = new Set()
    lockedPoints.forEach((p) => {
      if (p.lockState.techLockNo) used.add(p.lockState.techLockNo)
    })
    group.members.forEach((m) => {
      if (m.boxLock) used.add(m.boxLock)
      Object.values(m.locks || {}).forEach((no) => no && used.add(no))
    })

    let memberRecord
    if (effectiveMethod === 'box') {
      // One personal padlock on the box.
      const no = member.boxLock
      if (!no) throw new Error('Select a technician with a personal lock for the box')
      if (used.has(no)) throw new Error(`Lock ${no} is already in use on this equipment`)
      memberRecord = {
        techId: member.techId,
        name: member.name,
        joinedAt: new Date().toISOString(),
        boxLock: no,
      }
    } else {
      // Hasp: a unique department lock on every isolation point.
      const memberLocks = member.locks || {}
      const seen = new Set()
      for (const p of lockedPoints) {
        const no = memberLocks[p.key]
        if (!no) throw new Error('Select a Department lock for every isolation point')
        if (used.has(no) || seen.has(no)) {
          throw new Error(`Lock ${no} is already in use on this equipment`)
        }
        seen.add(no)
      }
      memberRecord = {
        techId: member.techId,
        name: member.name,
        joinedAt: new Date().toISOString(),
        locks: memberLocks,
      }
    }

    const next = {
      active: true,
      method: effectiveMethod,
      members: [...group.members, memberRecord],
    }
    update.groupLock = next
    update.lockSummary = computeLockSummary(points, next)
    tx.update(ref, update)
    tx.set(eventRef, {
      orgId: data.orgId,
      procedureId,
      equipment: data.equipment || '',
      site: data.site || '',
      procedureCode: data.procedureCode || '',
      pointKey: null,
      pointId: '',
      energy: `Group lock (${next.method === 'box' ? 'Group LOTO Box' : 'Hasp'})`,
      action: 'group_join',
      techName: member.name || null,
      by: user.id,
      byName: user.displayName,
      at: serverTimestamp(),
    })
  })
}

/** Remove a technician from the group lockout. */
export async function removeGroupMember(procedureId, techId, user) {
  const ref = doc(db, COL, procedureId)
  const eventRef = doc(collection(db, EVENTS))
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Procedure not found')
    const data = snap.data()
    const group = data.groupLock || { active: false, method: null, members: [] }
    const removed = group.members?.find((m) => m.techId === techId)
    const members = (group.members || []).filter((m) => m.techId !== techId)
    const next = {
      active: members.length > 0,
      method: members.length > 0 ? group.method : null,
      members,
    }
    tx.update(ref, {
      groupLock: next,
      lockSummary: computeLockSummary(data.isolationPoints || [], next),
      updatedAt: serverTimestamp(),
    })
    tx.set(eventRef, {
      orgId: data.orgId,
      procedureId,
      equipment: data.equipment || '',
      site: data.site || '',
      procedureCode: data.procedureCode || '',
      pointKey: null,
      pointId: '',
      energy: 'Group lock',
      action: 'group_leave',
      techName: removed?.name || null,
      by: user.id,
      byName: user.displayName,
      at: serverTimestamp(),
    })
  })
}

export async function getProcedure(id) {
  const snap = await getDoc(doc(db, COL, id))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export function subscribeProcedure(id, cb, onError) {
  return onSnapshot(
    doc(db, COL, id),
    (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    onError,
  )
}

export function subscribeOrgEvents(orgId, cb, onError) {
  // Append-only LOTO activity log. No server-side orderBy (no index); sort by
  // timestamp on the client, newest first.
  const q = query(collection(db, EVENTS), where('orgId', '==', orgId))
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      items.sort((a, b) => (b.at?.seconds || 0) - (a.at?.seconds || 0))
      cb(items)
    },
    onError,
  )
}

export function subscribeOrgProcedures(orgId, cb, onError) {
  // No server-side orderBy (avoids a composite index); sort on the client.
  const q = query(collection(db, COL), where('orgId', '==', orgId))
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      items.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0))
      cb(items)
    },
    onError,
  )
}
