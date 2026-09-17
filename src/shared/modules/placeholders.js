// ─────────────────────────────────────────────────────────────────────────────
// Module placeholders — the shape a brand-new organization starts with.
//
// The product used to treat an absent /moduleEntitlements document as "every
// module on". That is still true for organizations that registered before this
// file existed, so shipping it took nothing away from anyone. A NEW
// organization is different: createOrganization writes the document in the
// same batch as the org, with every registry key (and every add-on) set to
// false. Those rows are placeholders. They become usable when a platform
// operator activates them — the existing Module access screen, which is the
// subscription grant. Activating later does not recreate the org; it flips
// the same keys from false to true.
//
// Status is derived from the boolean the document already stores, rather than
// a parallel collection. A second set of records would be a second thing to
// drift from the rules, and the rules already enforce this map.
// ─────────────────────────────────────────────────────────────────────────────
import { MODULES, ADDONS, OPT_IN_KEYS } from './registry'

// Same key list entitlements.js exports as ALL_MODULE_KEYS. Derived here
// rather than imported, because entitlements.js talks to Firestore and this
// file is the pure half that org-create and the unit tests call.
const ALL_MODULE_KEYS = [...MODULES.map((m) => m.key), ...ADDONS.map((a) => a.key)]
const OPT_IN = new Set(OPT_IN_KEYS)

function keyIsActive(map, key) {
  if (!key || !ALL_MODULE_KEYS.includes(key)) return true
  if (OPT_IN.has(key)) return map?.[key] === true
  return map?.[key] !== false
}

export const MODULE_STATUS = {
  PLACEHOLDER: 'placeholder',
  ACTIVE: 'active',
}

/** Every known key off. The document createOrganization writes. */
export function placeholderModulesMap() {
  return Object.fromEntries(ALL_MODULE_KEYS.map((key) => [key, false]))
}

/**
 * One record per registry module (not add-ons). Add-ons are licensed the same
 * way but are not navigable, so they are not a launcher tile.
 */
export function placeholderRecords() {
  return MODULES.map((m) => ({
    key: m.key,
    status: MODULE_STATUS.PLACEHOLDER,
  }))
}

/** Status of one key under a (normalized or raw) map. */
export function moduleStatus(map, key) {
  return keyIsActive(map, key) ? MODULE_STATUS.ACTIVE : MODULE_STATUS.PLACEHOLDER
}

/** One record per known key, status derived from the entitlement map. */
export function recordsFromMap(map) {
  return ALL_MODULE_KEYS.map((key) => ({
    key,
    status: moduleStatus(map, key),
  }))
}

/**
 * Flip the named keys to active. Unknown keys are ignored rather than stored,
 * so a typo cannot park a phantom module on the document.
 *
 * Starts from a complete placeholder map so a partial `current` cannot leave
 * a key missing — missing would read as enabled under the legacy default.
 */
export function activateKeys(current, keysToActivate = []) {
  const next = {
    ...placeholderModulesMap(),
    ...(current && typeof current === 'object' ? current : {}),
  }
  for (const key of keysToActivate) {
    if (ALL_MODULE_KEYS.includes(key)) next[key] = true
  }
  return next
}

/**
 * A subscription grant: from a full set of placeholders, activate exactly
 * `keys`. Everything else stays a placeholder. Re-running with a different
 * set replaces the previous grant rather than merging — the operator's save
 * is the source of truth, not a stack of grants.
 */
export function subscriptionMap(keysToActivate = []) {
  return activateKeys(placeholderModulesMap(), keysToActivate)
}

/** True when every known key is off — the seeded placeholder document. */
export function isPlaceholderMap(map) {
  return ALL_MODULE_KEYS.every((key) => !keyIsActive(map, key))
}

/**
 * Fields written onto /moduleEntitlements/{orgId} for a placeholder seed.
 * `updatedAt` is supplied by the caller (serverTimestamp() at the write).
 */
export function placeholderEntitlementFields(actor = {}) {
  return {
    modules: placeholderModulesMap(),
    updatedBy: actor.uid || '',
    updatedByEmail: actor.email || '',
  }
}

export { ALL_MODULE_KEYS }
