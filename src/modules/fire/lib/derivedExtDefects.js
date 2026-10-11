// ─────────────────────────────────────────────────────────────────────────────
// Extinguisher conditions that belong on the Defect Repository without anyone
// having filed a physical-defect report for them:
//
//   • HPT due — deriveStatus().flags.HPT_DUE (dateOfNextHPT today or past, the
//     same rule as isHptOverdue / the "HPT Due" category). Overdue counts.
//   • Empty  — 'empty' is in ext.physicalDefects (the refill-triggering defect
//     set when an "Empty" defect report is approved or recorded).
//
// Closed units are skipped (deriveStatus does the same for HPT), and the list
// passed in is FleetContext's `extinguishers`, which already excludes the
// recycle bin; isDeleted is re-checked defensively. These rows are derived,
// not recorded defects, so they carry no resolve action — they are cleared by
// recording the HPT / refill on the extinguisher itself.
// ─────────────────────────────────────────────────────────────────────────────
import { deriveStatus, isDeleted } from './extinguisherLogic'

export const DERIVED_DEFECT = {
  HPT_DUE: { key: 'hpt_due', label: 'HPT due', color: '#b45309' },
  EMPTY: { key: 'empty', label: 'Empty', color: '#dc2626' },
}

/**
 * @param extinguishers active extinguishers
 * @param existingKeys  Set of `${extId}:${defectType}` already on the list
 */
export function deriveExtinguisherDefects(extinguishers = [], existingKeys = new Set(), today = new Date()) {
  const out = []
  for (const ext of extinguishers) {
    if (!ext || isDeleted(ext)) continue
    const d = deriveStatus(ext, today)
    if (d.isClosed) continue
    const push = (def, extra = {}) => {
      const id = `${ext.id}:${def.key}`
      if (existingKeys.has(id)) return
      existingKeys.add(id)
      out.push({
        id,
        extId: ext.id,
        derived: true,
        defectType: def.key,
        defectLabel: def.label,
        defectColor: def.color,
        serialNo: ext.serialNo || '',
        type: ext.type || '',
        capacity: ext.capacity || '',
        entity: ext.entity || '',
        region: ext.region || '',
        centerName: ext.centerName || '',
        location: ext.location || '',
        dateOfNextRefill: ext.dateOfNextRefill || '',
        dateOfNextHPT: ext.dateOfNextHPT || '',
        reportedAt: null,
        ...extra,
      })
    }
    if (d.flags.HPT_DUE) push(DERIVED_DEFECT.HPT_DUE, { dueDate: ext.dateOfNextHPT })
    if (d.refillDefects.includes('empty')) push(DERIVED_DEFECT.EMPTY)
  }
  return out
}
