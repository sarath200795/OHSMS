// ─────────────────────────────────────────────────────────────────────────────
// Ids for records the client makes up as it goes.
//
// Not document references. A hazard inside an assessment, a finding row inside
// an audit record, a person on an incident — things that live inside another
// document, need to be told apart, and are never quoted to anybody. Anything a
// human reads back over a phone goes through shared/docId/reserve instead,
// which is transactional and sequential.
//
// The rule this exists to enforce is that a clock is not an identifier. The
// audit module derived finding ids from `Date.parse(...) % 90000`, which wraps
// every ninety seconds and returns the SAME value for two rows added in the
// same millisecond — and those ids are what the central Action Tracker matches
// on, so two findings could become one.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A unique id, optionally prefixed.
 *
 * crypto.randomUUID where it exists, which is every browser this app supports.
 * The fallback is for jsdom and older test environments rather than for users;
 * it mixes the clock with randomness, so it is still unique in the same
 * millisecond, which is precisely where the version it replaced was not.
 */
export function uid(prefix = '') {
  const base =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return prefix ? `${prefix}_${base}` : base
}
