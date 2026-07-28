// Derive the Physical-Defect Open/Closed logs from approved defect reports
// joined against live extinguisher data. No schema change: "closed" simply
// means the defect is no longer active on its extinguisher (resolved / refilled
// away), or the extinguisher was deleted.
import { PHYSICAL_DEFECT_KEYS, DEFECT_BY_KEY } from './constants'

/**
 * @param reports  all org reports
 * @param extinguishers  live extinguishers
 * @returns { open: [...], closed: [...] } where each row is a flat object:
 *   { id, defectType, defectLabel, reportedAt, reviewedAt, reportId, deleted,
 *     serialNo, type, capacity, entity, region, centerName, qrToken,
 *     dateOfNextRefill, dateOfNextHPT, status }
 */
export function derivePhysicalDefectLog(reports = [], extinguishers = []) {
  const byId = new Map(extinguishers.map((e) => [e.id, e]))
  const open = []
  const closed = []

  for (const r of reports) {
    if (r.approvalStatus !== 'approved') continue
    if (r.kind !== 'defect') continue
    if (!PHYSICAL_DEFECT_KEYS.includes(r.defectType)) continue

    const ext = byId.get(r.extId)
    const base = {
      reportId: r.id,
      defectType: r.defectType,
      defectLabel: DEFECT_BY_KEY[r.defectType]?.label || r.defectType,
      reportedAt: r.reportedAt,
      reviewedAt: r.reviewedAt || null,
      reportedByName: r.reportedByName || '',
    }

    if (!ext) {
      // Extinguisher deleted — treat as closed, fill from the report label.
      closed.push({
        id: `${r.extId}:${r.defectType}`,
        deleted: true,
        serialNo: (r.extLabel || '').split(' · ')[0] || '—',
        type: '', capacity: '', entity: '', region: '', centerName: r.extLabel || '—',
        qrToken: null, status: 'deleted', dateOfNextRefill: '', dateOfNextHPT: '',
        ...base,
      })
      continue
    }

    const stillActive = Array.isArray(ext.physicalDefects) && ext.physicalDefects.includes(r.defectType)
    const row = {
      id: `${ext.id}:${r.defectType}`,
      extId: ext.id,
      deleted: false,
      serialNo: ext.serialNo || '',
      type: ext.type || '',
      capacity: ext.capacity || '',
      entity: ext.entity || '',
      region: ext.region || '',
      centerName: ext.centerName || '',
      qrToken: ext.qrToken || null,
      status: ext.status,
      dateOfNextRefill: ext.dateOfNextRefill || '',
      dateOfNextHPT: ext.dateOfNextHPT || '',
      lastActionBy: ext.lastActionBy || '',
      lastAction: ext.lastAction || '',
      ...base,
    }
    ;(stillActive ? open : closed).push(row)
  }

  return { open, closed }
}
