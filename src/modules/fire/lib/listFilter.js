// ─────────────────────────────────────────────────────────────────────────────
// Shared client-side filtering for extinguisher list pages. Every list page
// holds its full array in memory (from useFleet), so filtering is a pure
// Array.filter — no Firestore queries, no composite-index combinatorics.
//
// Filter model: each attribute field is an ARRAY of selected values.
//   - within a field  → OR  (Status = Active OR To Be Refilled matches either)
//   - across fields    → AND (Type=ABC AND Region=North)
//   - empty array      → no constraint for that field
// `search` is a plain substring over serial / center / type.
// ─────────────────────────────────────────────────────────────────────────────

// Kept for backward-compat with older imports; no longer used internally.
export const FILTER_ALL = '__all__'

export const FILTER_FIELDS = ['type', 'capacity', 'entity', 'region', 'status', 'defect']

/** A blank filter state — every field an empty array (no constraint). */
export function emptyFilters() {
  return { search: '', type: [], capacity: [], entity: [], region: [], status: [], defect: [] }
}

/** Normalize a value for tolerant equality: trim + collapse whitespace + lowercase. */
const norm = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

/** Coerce a field's filter value to an array (tolerates legacy string/FILTER_ALL). */
function asArray(v) {
  if (Array.isArray(v)) return v
  if (v == null || v === FILTER_ALL || v === '') return []
  return [v]
}

/** True when any filter is narrowing the set. */
export function hasActiveFilters(f = {}) {
  if (f.search && f.search.trim()) return true
  return FILTER_FIELDS.some((k) => asArray(f[k]).length > 0)
}

const matchesSearch = (item, q) =>
  `${item.serialNo || ''} ${item.centerName || ''} ${item.type || ''}`.toLowerCase().includes(q)

// OR within a field: the item matches if its value equals ANY selected value
// (tolerant of case/whitespace drift). Empty selection = no constraint.
function matchField(selected, itemVal) {
  const arr = asArray(selected)
  if (arr.length === 0) return true
  const n = norm(itemVal)
  return arr.some((v) => norm(v) === n)
}

/**
 * Filter rows by the given filters (OR within a field, AND across fields).
 * `status`/`defect` are only enforced when selected. Pure + unit-tested.
 */
export function applyListFilters(items = [], filters = {}) {
  const q = (filters.search || '').trim().toLowerCase()
  return items.filter((item) => {
    if (q && !matchesSearch(item, q)) return false
    if (!matchField(filters.type, item.type)) return false
    if (!matchField(filters.capacity, item.capacity)) return false
    if (!matchField(filters.entity, item.entity)) return false
    if (!matchField(filters.region, item.region)) return false
    if (!matchField(filters.status, item.status)) return false
    if (!matchField(filters.defect, item.defectType)) return false
    return true
  })
}
