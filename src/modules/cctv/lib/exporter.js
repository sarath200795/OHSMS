// ─────────────────────────────────────────────────────────────────────────────
// CCTV exports.
//
// Three separate defect extracts, because that separation is the point. A DVR
// with sixteen cameras that loses power produces ONE line in the DVR extract and
// none in the camera extract — the cameras are dark, not faulty, and a work
// order raised against each of them is sixteen wasted visits.
//
// Row builders are pure and exported so the column set is testable without
// writing a file; only the two `download*` functions touch the workbook.
// ─────────────────────────────────────────────────────────────────────────────

import * as XLSX from 'xlsx'
import { CAMERA_DEFECT_BY_KEY, DVR_DEFECT_BY_KEY, MERAKI_DEFECT_BY_KEY, CAUSE, CAUSE_LABEL } from './constants'

const labelFor = (table) => (keys = []) =>
  keys.map((k) => table[k]?.label || k).join(', ')

const cameraLabels = labelFor(CAMERA_DEFECT_BY_KEY)
const dvrLabels = labelFor(DVR_DEFECT_BY_KEY)
const merakiLabels = labelFor(MERAKI_DEFECT_BY_KEY)

const statusWord = (s) => (s === 'online' ? 'Online' : s === 'offline' ? 'Offline' : 'Unknown')

/**
 * Camera defect rows — only cameras that are actually at fault.
 *
 * `Fault` names what the device itself is guilty of. A camera darkened by its
 * DVR never reaches this sheet at all (health.cameraDefects filters it), so
 * every row here is a camera worth visiting.
 */
export const cameraDefectRows = (defects = []) =>
  defects.map((d) => ({
    Camera: d.name,
    Location: d.location || '—',
    Site: d.siteName || '—',
    DVR: d.dvrName || '—',
    Status: statusWord(d.status),
    Defects: cameraLabels(d.defects),
    'No. of Defects': d.defects.length,
    Fault: CAUSE_LABEL[d.cause] || '—',
  }))

export const dvrDefectRows = (defects = []) =>
  defects.map((d) => ({
    DVR: d.name,
    'IP Address': d.ipAddress || '—',
    Site: d.siteName || '—',
    Status: statusWord(d.status),
    Defects: dvrLabels(d.defects),
    'No. of Defects': d.defects.length,
    Fault: CAUSE_LABEL[d.cause] || '—',
  }))

export const merakiDefectRows = (defects = []) =>
  defects.map((d) => ({
    'Meraki Device': d.name,
    'IP Address': d.ipAddress || '—',
    Site: d.siteName || '—',
    Status: statusWord(d.status),
    Defects: merakiLabels(d.defects),
    'No. of Defects': d.defects.length,
  }))

/** Per-camera health, including the ones that are fine — this is the register. */
export const cameraHealthRows = (cameras = []) =>
  cameras.map((c) => ({
    Camera: c.name,
    Location: c.location || '—',
    Site: c.siteName || '—',
    DVR: c.dvrName || '—',
    'Reported Status': statusWord(c.reported),
    'Effective Status': statusWord(c.effective),
    // The column that stops a switch outage being read as camera failure.
    'Down Because': c.working ? '—' : CAUSE_LABEL[c.cause],
    'Blamed Device': c.blamedOn?.name || '—',
    'Visual Defects': cameraLabels(c.observedDefects) || '—',
    Healthy: c.healthy ? 'Yes' : 'No',
  }))

/** Per-DVR health, with how many of its cameras are actually up. */
export const dvrHealthRows = (rows = []) =>
  rows.map((d) => ({
    DVR: d.name,
    'IP Address': d.ipAddress || '—',
    Site: d.siteName || '—',
    Channels: d.channels || '—',
    'Reported Status': statusWord(d.reported),
    'Effective Status': statusWord(d.effective),
    'Down Because': d.working ? '—' : CAUSE_LABEL[d.cause],
    'Blamed Device': d.blamedOn?.name || '—',
    'No. of Cameras': d.cameras,
    'Cameras Online': d.camerasOnline,
    'Cameras Offline': d.camerasOffline,
    'Camera Uptime %': d.cameraUptime,
    Health: d.band?.label || '—',
  }))

export const merakiHealthRows = (merakis = []) =>
  merakis.map((m) => ({
    'Meraki Device': m.name,
    'IP Address': m.ipAddress || '—',
    Site: m.siteName || '—',
    Status: statusWord(m.effective),
    // A down Meraki is never someone else's fault — nothing sits above it.
    Impact: m.working ? '—' : 'All DVRs and cameras at this site are dark',
  }))

export const siteHealthRows = (sites = []) =>
  sites.map((s) => ({
    Site: s.siteName,
    'No. of Cameras': s.cameras,
    'Cameras Online': s.camerasOnline,
    'Camera Uptime %': s.cameraUptime,
    'No. of DVR': s.dvrs,
    'DVR Online': s.dvrsOnline,
    'No. of Meraki': s.merakis,
    'Meraki Online': s.merakisOnline,
    Health: s.band?.label || '—',
  }))

const stamp = (now) => {
  const d = now instanceof Date ? now : new Date(now || Date.now())
  return d.toISOString().slice(0, 10)
}

/** A sheet with a single "nothing to report" row beats a blank tab. */
const sheet = (rows, emptyMessage) =>
  XLSX.utils.json_to_sheet(rows.length ? rows : [{ Result: emptyMessage }])

/**
 * The defect extract, three sheets in one workbook.
 *
 * One file rather than three downloads: they are read together — "is this
 * camera broken, or is its DVR?" is the first question anyone asks — and
 * separate files make that comparison a manual join.
 */
export function downloadDefects(estate, { orgName = '', now } = {}) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    wb, sheet(cameraDefectRows(estate.defects.camera), 'No camera defects'), 'Camera Defects'
  )
  XLSX.utils.book_append_sheet(
    wb, sheet(dvrDefectRows(estate.defects.dvr), 'No DVR defects'), 'DVR Defects'
  )
  XLSX.utils.book_append_sheet(
    wb, sheet(merakiDefectRows(estate.defects.meraki), 'No Meraki defects'), 'Meraki Defects'
  )
  XLSX.writeFile(wb, `CCTV_Defects_${orgName ? `${orgName}_` : ''}${stamp(now)}.xlsx`)
}

/** The health report: per-site, per-DVR and per-camera, plus the Meraki layer. */
export function downloadHealth(estate, { orgName = '', now } = {}) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet(siteHealthRows(estate.siteReport), 'No sites'), 'Site Health')
  XLSX.utils.book_append_sheet(wb, sheet(dvrHealthRows(estate.dvrReport), 'No DVRs'), 'DVR Health')
  XLSX.utils.book_append_sheet(wb, sheet(cameraHealthRows(estate.cameras), 'No cameras'), 'Camera Health')
  XLSX.utils.book_append_sheet(wb, sheet(merakiHealthRows(estate.merakis), 'No Meraki devices'), 'Meraki Health')
  XLSX.writeFile(wb, `CCTV_Health_${orgName ? `${orgName}_` : ''}${stamp(now)}.xlsx`)
}

/** One sheet per device kind, for the plain inventory. */
export function downloadInventory({ cameras = [], dvrs = [], merakis = [] }, { orgName = '', now } = {}) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet(cameras.map((c) => ({
    Camera: c.name, Location: c.location || '—', Site: c.siteName || '—',
    DVR: c.dvrName || '—', Make: c.make || '—', Model: c.model || '—',
    Channel: c.channel || '—', Status: statusWord(c.status),
  })), 'No cameras'), 'Cameras')
  XLSX.utils.book_append_sheet(wb, sheet(dvrs.map((d) => ({
    DVR: d.name, 'IP Address': d.ipAddress || '—', Site: d.siteName || '—',
    Channels: d.channels || '—', Make: d.make || '—', Model: d.model || '—',
    Location: d.location || '—', Status: statusWord(d.status),
  })), 'No DVRs'), 'DVR')
  XLSX.utils.book_append_sheet(wb, sheet(merakis.map((m) => ({
    'Meraki Device': m.name, 'IP Address': m.ipAddress || '—', Site: m.siteName || '—',
    Model: m.model || '—', Serial: m.serial || '—', Status: statusWord(m.status),
  })), 'No Meraki devices'), 'Meraki')
  XLSX.writeFile(wb, `CCTV_Inventory_${orgName ? `${orgName}_` : ''}${stamp(now)}.xlsx`)
}

export { CAUSE }
