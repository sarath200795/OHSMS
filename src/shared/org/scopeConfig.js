// ─────────────────────────────────────────────────────────────────────────────
// Scope granularity configuration (org-level, per module).
//
// A module's "scope" is the ordered list of levels a user fills in to pin down a
// specific site / location. Built-in levels (Region, Entity) map to fixed site
// fields; admin-defined custom levels (e.g. Building, Floor) map to
// site.attributes[key]. The final level is always the Site record itself.
//
// Stored on the org document as:
//   scopeConfig: {
//     customFields: [{ key, label }],          // extra site attributes
//     modules: { [moduleKey]: [levelKey, …] }, // ordered, ends with 'site'
//   }
// An unset module falls back to the default Region → Entity → Site.
// ─────────────────────────────────────────────────────────────────────────────

export const SITE_LEVEL_KEY = 'site'
export const SITE_LEVEL = { key: SITE_LEVEL_KEY, label: 'Site', site: true }

// Built-in grouping fields that already exist on every site record.
export const BUILTIN_FIELDS = [
  { key: 'region', label: 'Region' },
  { key: 'entity', label: 'Entity' },
]
const BUILTIN_KEYS = BUILTIN_FIELDS.map((f) => f.key)

export const DEFAULT_LEVEL_KEYS = ['region', 'entity', SITE_LEVEL_KEY]

// Turn a free-text label into a stable, storage-safe field key.
export const toFieldKey = (s) =>
  (s || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

// Reserved keys custom fields may not reuse.
const RESERVED = new Set([...BUILTIN_KEYS, SITE_LEVEL_KEY, 'name', 'address', 'lat', 'lng'])

/** Normalize a raw org.scopeConfig into a safe, predictable shape. */
// De-duplicate a list of predefined option strings, trimmed and non-empty.
export function cleanOptions(options) {
  const seen = new Set()
  return (Array.isArray(options) ? options : [])
    .map((o) => (o ?? '').toString().trim())
    .filter((o) => o && !seen.has(o) && seen.add(o))
}

export function normalizeScopeConfig(raw = {}) {
  const seen = new Set()
  const customFields = (Array.isArray(raw?.customFields) ? raw.customFields : [])
    .map((f) => ({
      key: toFieldKey(f?.key || f?.label),
      label: (f?.label || f?.key || '').toString().trim(),
      options: cleanOptions(f?.options),
    }))
    .filter((f) => f.key && f.label && !RESERVED.has(f.key) && !seen.has(f.key) && seen.add(f.key))
  const modules = raw?.modules && typeof raw.modules === 'object' ? raw.modules : {}
  return { customFields, modules }
}

/** Every field usable as a scope level: built-ins, the Site leaf, and customs. */
export function availableFields(org) {
  return [...BUILTIN_FIELDS, SITE_LEVEL, ...normalizeScopeConfig(org?.scopeConfig).customFields]
}

/**
 * Ordered level KEYS for a module (defaults when unset). Site is a normal level
 * that can appear anywhere, or be omitted entirely — nothing is forced. Unknown
 * keys are dropped and order is preserved; an empty result falls back to default.
 */
export function moduleLevelKeys(org, moduleKey) {
  const { modules, customFields } = normalizeScopeConfig(org?.scopeConfig)
  const valid = new Set([...BUILTIN_KEYS, SITE_LEVEL_KEY, ...customFields.map((f) => f.key)])
  const raw = Array.isArray(modules?.[moduleKey]) && modules[moduleKey].length
    ? modules[moduleKey]
    : DEFAULT_LEVEL_KEYS
  const seen = new Set()
  const keys = raw.filter((k) => valid.has(k) && !seen.has(k) && seen.add(k))
  return keys.length ? keys : DEFAULT_LEVEL_KEYS
}

/** Ordered level DESCRIPTORS {key,label,site,options} for a module. */
export function moduleLevels(org, moduleKey) {
  const byKey = Object.fromEntries(availableFields(org).map((f) => [f.key, f]))
  return moduleLevelKeys(org, moduleKey).map((k) =>
    k === SITE_LEVEL_KEY
      ? { ...SITE_LEVEL, options: [] }
      : { key: k, label: byKey[k]?.label || k, site: false, options: byKey[k]?.options || [] }
  )
}

/** The default Region → Entity → Site descriptors (no module / no config). */
export function defaultLevels() {
  return [
    { key: 'region', label: 'Region', site: false },
    { key: 'entity', label: 'Entity', site: false },
    { ...SITE_LEVEL },
  ]
}

/** Read a site's value for a given level key. */
export function siteLevelValue(site, key) {
  if (!site) return ''
  if (key === SITE_LEVEL_KEY) return site.name || ''
  if (key === 'region') return site.region || ''
  if (key === 'entity') return site.entity || ''
  return (site.attributes && site.attributes[key]) || ''
}

/** Distinct, sorted, non-empty values of a field across sites. */
export function distinctSiteValues(sites, key) {
  const set = new Set()
  for (const s of sites || []) {
    const v = siteLevelValue(s, key)
    if (v) set.add(v)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}
