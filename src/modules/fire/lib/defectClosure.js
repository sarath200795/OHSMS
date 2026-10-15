// ─────────────────────────────────────────────────────────────────────────────
// Closing a defect, as distinct from approving the report that raised it.
//
// The Defect Repository used to have no last step. Resolving a physical fault
// deleted it from the unit, an HPT-due or Empty row existed only while the
// register still said so, and an AED or fire-alarm report could be confirmed
// or dismissed but never closed. None of those left a closure: who, when,
// what was said, or a photograph of the repair. A defect that left the open
// list left no record that it had been closed, so the Closed filter and the
// export had nothing to show.
//
// A closure is a document in defectClosures plus, where the open row is
// derived from the unit, the change that takes the row off the open list.
// Empty and the other refill faults leave physicalDefects. An HPT-due row is
// a date, and writing a later date here would be a passed test that never
// happened — hpt.js refuses that for the same reason — so the close is stored
// against the due date it was closed for (`hptClosedFor`). Editing that date,
// or recording a real test, makes the row open again. The overdue COUNT on
// the site lookup stays the date; only the defect row is suppressed.
// ─────────────────────────────────────────────────────────────────────────────
import { DEFECT_BY_KEY, REFILL_DEFECT_KEYS } from './constants'
import { toDate } from './extinguisherLogic'
import { isFutureDate } from '../../../shared/lib/dates'

export const CLOSURE_SOURCE = {
  MANUAL: 'manual',
  RECEIVED: 'received',
  REFILLED: 'refilled',
  RESOLVE: 'resolve',
  HPT: 'hpt',
}

const PHOTO_KEYS = ['url', 'path', 'dataUrl', 'contentType', 'name', 'size']

/** True when this unit's HPT-due defect was closed against the date it still carries. */
export function hptSuppressed(ext) {
  const forDate = ext?.hptClosedFor
  return typeof forDate === 'string' && forDate !== '' && forDate === (ext?.dateOfNextHPT || '')
}

export function validateClosure({ remarks, closedOn } = {}) {
  const text = String(remarks ?? '').trim()
  if (!text) return 'Enter closure remarks'
  if (text.length > 2000) return 'Closure remarks are too long'
  if (!toDate(closedOn)) return 'Enter the date the defect was closed'
  if (isFutureDate(closedOn)) return 'The closed date is in the future'
  return ''
}

/** The photo pointer a closure may store. Anything else on the picked file is dropped. */
export function cleanClosurePhoto(p) {
  if (!p || typeof p !== 'object') return null
  const out = {}
  for (const k of PHOTO_KEYS) {
    if (p[k] !== undefined && p[k] !== null && p[k] !== '') out[k] = p[k]
  }
  return out.path || out.url || out.dataUrl ? out : null
}

/**
 * Who closed it is the signed-in person. A typed name would let the form
 * attribute the close to someone who was not there; the audit log has the
 * same rule.
 */
export function closureFields({ remarks, closedOn, closedBy, closedByUid, photo, source } = {}) {
  return {
    remarks: String(remarks ?? '').trim(),
    closedOn: closedOn || '',
    closedBy: closedBy || '',
    closedByUid: closedByUid || '',
    photo: cleanClosurePhoto(photo),
    source: source || CLOSURE_SOURCE.MANUAL,
  }
}

/**
 * The extinguisher fields a close of `defectType` writes.
 * HPT does not move dateOfNextHPT. Every other type leaves the defect array.
 */
export function extinguisherCloseUpdate(ext, defectType) {
  if (defectType === 'hpt_due') {
    return { hptClosedFor: ext?.dateOfNextHPT || '' }
  }
  const current = Array.isArray(ext?.physicalDefects) ? ext.physicalDefects : []
  return { physicalDefects: current.filter((k) => k !== defectType) }
}

/** Refill faults a vendor return clears. A dent stays; a recharge does not fix it. */
export function refillDefectsOf(ext) {
  const current = Array.isArray(ext?.physicalDefects) ? ext.physicalDefects : []
  return current.filter((k) => REFILL_DEFECT_KEYS.includes(k))
}

export function extinguisherClosureDoc(ext, defectType, closure, { forDate } = {}) {
  const label =
    defectType === 'hpt_due' ? 'HPT due' : DEFECT_BY_KEY[defectType]?.label || defectType
  return {
    defectKey: `${ext.id}:${defectType}`,
    kind: 'extinguisher',
    defectType,
    defectLabel: label,
    extId: ext.id || '',
    assetKind: '',
    assetRefId: '',
    reportId: '',
    serialNo: ext.serialNo || '',
    type: ext.type || '',
    capacity: ext.capacity || '',
    entity: ext.entity || '',
    region: ext.region || '',
    centerName: ext.centerName || '',
    location: ext.location || '',
    forDate: forDate || (defectType === 'hpt_due' ? ext.dateOfNextHPT || '' : ''),
    ...closure,
  }
}

export function assetClosureDoc(descriptor, closure) {
  const kind = descriptor.assetKind === 'fas' ? 'fas' : 'aed'
  return {
    defectKey: descriptor.reportId || '',
    kind,
    defectType: 'asset',
    defectLabel: descriptor.defectLabel || 'Reported defect',
    extId: '',
    assetKind: kind,
    assetRefId: descriptor.assetRefId || '',
    reportId: descriptor.reportId || '',
    serialNo: descriptor.serialNo || descriptor.assetLabel || '',
    type: '',
    capacity: '',
    entity: descriptor.entity || '',
    region: descriptor.region || '',
    centerName: descriptor.centerName || '',
    location: descriptor.location || '',
    forDate: '',
    ...closure,
  }
}

/**
 * The fields closeDefect reads off a Defect Repository row. Lives with the
 * closure shape so the modal file only exports the component.
 */
export function descriptorOf(row) {
  const r = row.raw || {}
  if (row.source === 'asset') {
    return {
      kind: r.assetKind === 'fas' ? 'fas' : 'aed',
      assetKind: r.assetKind,
      defectType: 'asset',
      defectLabel: row.defect || r.defect || 'Reported defect',
      reportId: r.id,
      assetRefId: r.assetRefId,
      assetLabel: r.assetLabel || row.label,
      serialNo: row.label || '',
      centerName: row.site || '',
      region: row.region || '',
      entity: row.entity || '',
      location: row.location || '',
    }
  }
  return {
    kind: 'extinguisher',
    defectType: r.defectType,
    defectLabel: row.defect || r.defectLabel || r.defectType,
    extId: r.extId,
    reportId: r.reportId || '',
    serialNo: r.serialNo || row.label || '',
    type: r.type || '',
    capacity: r.capacity || '',
    entity: row.entity || r.entity || '',
    region: row.region || r.region || '',
    centerName: row.site || r.centerName || '',
    location: row.location || r.location || '',
  }
}

/** One closure per defect a vendor return actually clears. */
export function receiveClosures(ext, { receivedOn, closedBy, closedByUid } = {}) {
  const closure = closureFields({
    remarks: 'Received back from vendor',
    closedOn: receivedOn,
    closedBy,
    closedByUid,
    source: CLOSURE_SOURCE.RECEIVED,
  })
  return refillDefectsOf(ext).map((defectType) => extinguisherClosureDoc(ext, defectType, closure))
}
