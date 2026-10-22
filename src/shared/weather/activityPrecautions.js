// The digest runs in functions/ and cannot import the SPA, so the catalog
// lives next to the mail. This is the settings screen's door onto the same
// sentences: a second copy would drift, and the mail would say something the
// admin did not edit.
import { ACTIVITY_TYPES } from '../org/orgConstants'
import {
  ALERTS,
  CATALOG,
  FACILITY_LABELS,
  builtInPrecaution,
  canonicalFacility,
  chooseActivities,
  editorRows,
  normalizeOverrides,
  packOverrides,
  precautionText,
} from '../../../functions/lib/weatherPrecautions.js'

export {
  ALERTS,
  CATALOG,
  FACILITY_LABELS,
  builtInPrecaution,
  canonicalFacility,
  chooseActivities,
  editorRows,
  normalizeOverrides,
  packOverrides,
  precautionText,
}

/** Industry list first, then the work a permit or a HIRA title can name. */
export function activityPickerOptions(selected = []) {
  const extras = CATALOG.filter((entry) => entry.extra).map((entry) => entry.label)
  return [...new Set([...ACTIVITY_TYPES, ...extras, ...(selected || [])].filter(Boolean))]
}
