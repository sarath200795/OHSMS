// Soft-delete window for extinguishers, AEDs and fire-alarm panels.
//
// The register used to remove the public QR mirror in the same write that set
// deletedAt. A sticker already on the cylinder then scanned as "code not
// recognised", which is what a code that was never ours looks like, so a
// delete read as permanent even though the asset document was still there.
// The mirror now stays, marked deleted, until restore or the 30-day purge.
//
// Records that predate the field have no deletedAt at all. Absent and null
// are both "in service". Treating a missing field as deleted would hide the
// existing fleet the day this ships.

import { toDate } from './extinguisherLogic'

export const PURGE_AFTER_DAYS = 30

export const EQUIPMENT_KINDS = {
  extinguisher: { codeField: 'serialNo', codeLabel: 'serial number', noun: 'fire extinguisher' },
  aed: { codeField: 'assetId', codeLabel: 'asset code', noun: 'AED' },
  fas: { codeField: 'deviceId', codeLabel: 'device code', noun: 'fire alarm panel' },
}

const norm = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()

// Words a person types when they mean the kind, not the serial. The noun on
// EQUIPMENT_KINDS is what the scan page says; the short names are what the
// registers are called in the navigation.
const KIND_WORDS = {
  extinguisher: ['extinguisher', 'fire extinguisher'],
  aed: ['aed'],
  fas: ['fas', 'fire alarm', 'fire alarm panel'],
}

/**
 * Whether this bin row matches a search box.
 *
 * One substring over the fields someone hunts by, the same shape as the live
 * extinguisher list (`serial / center / type`). Case-insensitive, partial.
 * An empty query matches everything, so the unfiltered bin is the full list
 * in its existing order.
 *
 * The bin is already the deleted slice of the in-memory fleet. Searching it
 * here cannot see a row the load cap dropped, and neither can the live lists.
 */
export function matchesBinSearch(row, query) {
  const q = norm(query)
  if (!q || !row) return !q ? true : false
  const parts = [
    ...(KIND_WORDS[row.kind] || []),
    row.serialNo,
    row.assetId,
    row.deviceId,
    row.label,
    row.qrToken,
    row.centerName,
    row.siteName,
    row.site,
    row.location,
    row.zone,
    row.type,
    row.capacity,
    row.deviceType,
    row.brand,
    row.model,
    row.region,
    row.entity,
    row.deletedBy,
  ]
  return parts.filter(Boolean).join(' ').toLowerCase().includes(q)
}

/** In the recycle bin. A missing record is not; a missing deletedAt is not. */
export function isRetired(record) {
  return Boolean(record && record.deletedAt)
}

/** Whole days until the nightly purge may destroy this row. */
export function daysRemaining(deletedAt, now = new Date(), days = PURGE_AFTER_DAYS) {
  const d = toDate(deletedAt)
  if (!d) return days
  const elapsed = Math.floor((now.getTime() - d.getTime()) / 86400000)
  return Math.max(0, days - elapsed)
}

/**
 * May this person delete or restore this unit?
 *
 * Org admins reach every unit. A manager reaches one whose site, region or
 * entity is in their grant — the same three scopes resolveAccessibleSites()
 * uses — or whose site is their own posting. A unit with none of those set
 * is org-level stock: only an admin can retire it. Members cannot.
 *
 * `isAdmin` / `isManager` are the platform flags, not the equipment module's
 * mapped role. That map turns a manager into `profile.role === 'admin'`, and
 * trusting it here would let every manager purge the whole fleet.
 */
export function canManageAsset(user, asset, { isAdmin = false, isManager = false } = {}) {
  if (!asset) return false
  if (isAdmin) return true
  if (!isManager || !user) return false
  const access = user.access || {}
  const sites = new Set(
    [...(Array.isArray(access.sites) ? access.sites : []), user.siteId].filter(Boolean)
  )
  const regions = new Set(Array.isArray(access.regions) ? access.regions : [])
  const entities = new Set(Array.isArray(access.entities) ? access.entities : [])
  if (asset.siteId && sites.has(asset.siteId)) return true
  if (asset.region && regions.has(asset.region)) return true
  if (asset.entity && entities.has(asset.entity)) return true
  return false
}

function codeOf(record, field) {
  return norm(record?.[field])
}

/**
 * Why these rows cannot come back.
 *
 * A serial or a QR token that a live unit already holds must not be revived
 * onto a second one: the sticker and the serial are how someone tells two
 * cylinders apart. Two deleted rows that share a code are the same collision
 * with each other.
 */
export function restoreConflicts(candidates, live, kind) {
  const spec = EQUIPMENT_KINDS[kind]
  if (!spec) return []
  const codes = new Map()
  const tokens = new Map()
  for (const row of live || []) {
    if (!row || row.deletedAt) continue
    const code = codeOf(row, spec.codeField)
    if (code && !codes.has(code)) codes.set(code, row)
    const token = String(row.qrToken || '').trim()
    if (token && !tokens.has(token)) tokens.set(token, row)
  }
  const conflicts = []
  const seenCodes = new Set()
  const seenTokens = new Set()
  for (const row of candidates || []) {
    if (!row) continue
    const code = codeOf(row, spec.codeField)
    const token = String(row.qrToken || '').trim()
    const reasons = []
    if (code && codes.has(code)) {
      reasons.push(`Its ${spec.codeLabel} ${row[spec.codeField]} is already in use.`)
    }
    if (code && seenCodes.has(code)) {
      reasons.push(`Its ${spec.codeLabel} ${row[spec.codeField]} is on more than one deleted unit.`)
    }
    if (token && tokens.has(token)) reasons.push('Its QR code is already in use.')
    if (token && seenTokens.has(token))
      reasons.push('Its QR code is on more than one deleted unit.')
    if (code) seenCodes.add(code)
    if (token) seenTokens.add(token)
    if (reasons.length) conflicts.push({ id: row.id, reasons })
  }
  return conflicts
}

export function restoreBlockMessage(candidates, live, kind) {
  const conflicts = restoreConflicts(candidates, live, kind)
  if (!conflicts.length) return ''
  return conflicts.map((c) => c.reasons[0]).join(' ') + ' Restore was not applied.'
}

/**
 * Refuse a new unit that would take a code or QR token the bin is still holding.
 * A live serial is an update on import, so this only speaks about creates.
 */
export function holdRetiredImports(rows, { live = [], deleted = [], codeField = 'serialNo' } = {}) {
  const retiredCodes = new Map()
  for (const row of deleted) {
    const code = codeOf(row, codeField)
    if (code) retiredCodes.set(code, row)
  }
  const takenTokens = new Map()
  for (const row of [...live, ...deleted]) {
    const token = String(row?.qrToken || '').trim()
    if (token && !takenTokens.has(token)) takenTokens.set(token, row)
  }
  const fresh = []
  const held = []
  for (const row of rows || []) {
    const code = codeOf(row, codeField)
    const token = String(row?.qrToken || '').trim()
    if (code && retiredCodes.has(code)) {
      held.push({
        row,
        reason: `Serial ${row[codeField]} is in Recently deleted. Restore that unit instead of adding it again.`,
      })
      continue
    }
    if (token && takenTokens.has(token)) {
      const owner = takenTokens.get(token)
      held.push({
        row,
        reason: owner?.deletedAt
          ? 'That QR code belongs to a unit in Recently deleted. Restore it instead of minting a second one.'
          : 'That QR code is already in use.',
      })
      continue
    }
    fresh.push(row)
    if (token) takenTokens.set(token, row)
  }
  return { fresh, held }
}

/**
 * Why a single add should stop, or '' when it should proceed.
 * Live and deleted registers are both checked: a serial the bin still holds
 * is not free, and neither is one already on the wall.
 */
export function adoptionBlock({
  serial,
  token,
  live = [],
  deleted = [],
  codeField = 'serialNo',
} = {}) {
  const spec =
    Object.values(EQUIPMENT_KINDS).find((k) => k.codeField === codeField) ||
    EQUIPMENT_KINDS.extinguisher
  const s = norm(serial)
  const t = norm(token)
  if (t) {
    const hit = [...live, ...deleted].find((r) => norm(r?.qrToken) === t)
    if (hit) {
      return hit.deletedAt
        ? 'That QR code belongs to a unit in Recently deleted. Restore it instead of creating a new one.'
        : 'That QR code is already in use.'
    }
  }
  if (s) {
    const retired = deleted.find((r) => codeOf(r, codeField) === s)
    if (retired) {
      return `That ${spec.codeLabel} is in Recently deleted. Restore it instead of creating a new one.`
    }
    const active = live.find((r) => codeOf(r, codeField) === s)
    if (active) return `That ${spec.codeLabel} is already in the register.`
  }
  return ''
}

/** Copy for the public scan page. No name of who deleted it: the mirror is world-readable. */
export function retiredQrCopy(asset) {
  const kind = asset?.assetKind || 'extinguisher'
  const spec = EQUIPMENT_KINDS[kind] || EQUIPMENT_KINDS.extinguisher
  const label = asset?.serialNo || asset?.label || ''
  return {
    title: `This ${spec.noun} was deleted`,
    detail: label
      ? `${label} is not in service. It can be restored for ${PURGE_AFTER_DAYS} days; until then this sticker will not open an inspection.`
      : `It is not in service. It can be restored for ${PURGE_AFTER_DAYS} days; until then this sticker will not open an inspection.`,
  }
}
