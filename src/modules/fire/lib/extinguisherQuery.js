// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers describing the server-side extinguisher query for the paginated
// Repository. Kept Firestore-free so the filter logic is unit-testable;
// firestore.js turns these descriptors into actual where()/orderBy() calls.
//
// Only STORED equality fields are server-filterable. Text search and the
// derived condition/due categories are applied page-locally in the UI.
// ─────────────────────────────────────────────────────────────────────────────

export const SERVER_FILTER_FIELDS = ['type', 'capacity', 'entity', 'region', 'status']

const ALL = '__all__'

/**
 * Given a filters object (e.g. { type:'ABC', region:'__all__', ... }), return
 * the list of active equality constraints as plain descriptors:
 *   [{ field:'deletedAt', op:'==', value:null }, { field:'type', op:'==', value:'ABC' }, ...]
 * `deletedAt == null` is always included (exclude soft-deleted). Pure + ordered
 * so it's deterministic for tests.
 */
export function buildExtinguisherConstraints(filters = {}) {
  const out = [{ field: 'deletedAt', op: '==', value: null }]
  for (const field of SERVER_FILTER_FIELDS) {
    const v = filters[field]
    if (v && v !== ALL) out.push({ field, op: '==', value: v })
  }
  return out
}

/** True if any server-side filter (beyond the implicit deletedAt) is active. */
export function hasServerFilters(filters = {}) {
  return SERVER_FILTER_FIELDS.some((f) => filters[f] && filters[f] !== ALL)
}

export const FILTER_ALL = ALL
