// ─────────────────────────────────────────────────────────────────────────────
// Subscription suites — bundles of registry modules.
//
// Nothing in the product named these before. Packaging lived only as per-module
// toggles on /platform. Suites are the missing half of that grant: an operator
// assigns Core (or Operations, Fire & Emergency, Compliance, Full) and every
// placeholder in the bundle flips to active. À-la-carte is still the individual
// switch — a suite does not replace the map, it is a way to write several keys
// at once.
//
// Definitions live here, next to the registry, not in Firestore. A document a
// tenant can read is the wrong place to keep a price list, and an operator
// inventing a suite in the console would be a second source of truth the rules
// cannot see. Custom sets are just the modules map plus `suite: 'custom'`.
//
// The four packaging suites PARTITION the registry. Full is their union.
// Add-ons (ODIN) are never in a suite: they stay opt-in à-la-carte.
// ─────────────────────────────────────────────────────────────────────────────
import { MODULES } from './registry'
import { activateKeys, placeholderModulesMap, subscriptionMap } from './placeholders'

export const SUITES = [
  {
    key: 'core',
    label: 'Core',
    title: 'Core',
    description:
      'Incidents, risk assessment, inspections, training, documents and the action tracker.',
    keys: ['incidents', 'hira', 'inspections', 'training', 'documents', 'actions'],
  },
  {
    key: 'operations',
    label: 'Operations',
    title: 'Operations',
    description: 'Permit to work, LOTO, site weather risk and CCTV.',
    keys: ['ptw', 'loto', 'weather', 'cctv'],
  },
  {
    key: 'fire',
    label: 'Fire & Emergency',
    title: 'Fire & Emergency',
    description: 'Emergency equipment, mock drills and FERP / emergency response.',
    keys: ['equipment', 'drills', 'emergency'],
  },
  {
    key: 'compliance',
    label: 'Compliance',
    title: 'Compliance',
    description: 'Internal audit, HSE committee, objectives and stakeholder issues.',
    keys: ['audit', 'committee', 'objectives', 'stakeholder'],
  },
  {
    key: 'full',
    label: 'Full',
    title: 'Full platform',
    description: 'Every operating module. Add-ons stay à-la-carte.',
    keys: MODULES.map((m) => m.key),
  },
]

export const SUITE_BY_KEY = Object.fromEntries(SUITES.map((s) => [s.key, s]))

/** The four bundles an operator assigns; Full is the union, not a grouping. */
export const PACKAGING_SUITES = SUITES.filter((s) => s.key !== 'full')

const MODULE_KEYS = MODULES.map((m) => m.key)

function activeModuleKeys(map) {
  return MODULE_KEYS.filter((key) => {
    if (!map || typeof map !== 'object') return false
    return map[key] === true
  })
}

function suiteKeysOn(map, keys) {
  return keys.every((key) => map?.[key] === true)
}

/** The packaging suite a module belongs to, or null for add-ons / unknown. */
export function suiteForModule(key) {
  return PACKAGING_SUITES.find((s) => s.keys.includes(key)) || null
}

/**
 * Activate every key in `suiteKey` on top of `current`. Other modules are
 * left as they were — that is how an org subscribes to Operations without
 * losing Core, and how à-la-carte extras survive applying a second suite.
 *
 * Unknown suite keys are a no-op rather than a wipe.
 */
export function activateSuite(current, suiteKey) {
  const suite = SUITE_BY_KEY[suiteKey]
  if (!suite) {
    return {
      ...placeholderModulesMap(),
      ...(current && typeof current === 'object' ? current : {}),
    }
  }
  return activateKeys(current, suite.keys)
}

/**
 * Replace the grant with exactly this suite. Used when the operator means
 * "this is their package", not "add this package to what they already have".
 */
export function assignSuite(suiteKey) {
  const suite = SUITE_BY_KEY[suiteKey]
  return subscriptionMap(suite ? suite.keys : [])
}

/**
 * What the current map is, as a subscription.
 *
 * `key` is what we persist on `/moduleEntitlements/{orgId}.suite`:
 *   ''         every operating module still a placeholder
 *   a suite    the map is exactly that suite (no extras, nothing missing)
 *   'custom'   anything else — including two suites combined, or à-la-carte
 *
 * `matched` is every packaging suite whose keys are all on, so the console
 * can highlight Core even when Operations has been added on top.
 */
export function describeGrant(map) {
  const active = activeModuleKeys(map)
  const activeSet = new Set(active)

  if (active.length === 0) {
    return {
      key: '',
      label: 'Placeholders only',
      matched: [],
      extras: [],
    }
  }

  if (active.length === MODULE_KEYS.length && MODULE_KEYS.every((k) => activeSet.has(k))) {
    return {
      key: 'full',
      label: SUITE_BY_KEY.full.label,
      matched: [...PACKAGING_SUITES],
      extras: [],
    }
  }

  const exact = PACKAGING_SUITES.find((s) => {
    if (s.keys.length !== active.length) return false
    return s.keys.every((k) => activeSet.has(k))
  })
  if (exact) {
    return { key: exact.key, label: exact.label, matched: [exact], extras: [] }
  }

  const matched = PACKAGING_SUITES.filter((s) => suiteKeysOn(map, s.keys))
  const covered = new Set(matched.flatMap((s) => s.keys))
  const extras = active.filter((k) => !covered.has(k))

  if (matched.length === 1 && extras.length === 0) {
    return { key: matched[0].key, label: matched[0].label, matched, extras: [] }
  }

  const names = matched.map((s) => s.label)
  const label = names.length
    ? extras.length
      ? `${names.join(' + ')}, plus à-la-carte`
      : names.join(' + ')
    : 'Custom'

  return { key: 'custom', label, matched, extras }
}

/** Persistable `suite` field for an operator save of this map. */
export function assignedSuiteKey(map) {
  return describeGrant(map).key
}

export function suiteIsFullyOn(map, suiteKey) {
  const suite = SUITE_BY_KEY[suiteKey]
  return Boolean(suite && suiteKeysOn(map, suite.keys))
}
