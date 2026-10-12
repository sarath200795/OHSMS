// ─────────────────────────────────────────────────────────────────────────────
// Who may ask, and about which sites.
//
// Re-checked on EVERY message against the live /users profile, never cached on
// the link. Suspending, rejecting or moving someone therefore takes effect on
// their next message, with no token-lifetime window in which a removed person
// can still read site data from their phone.
//
// Same test the rules apply to the app (isApprovedMemberOf in firestore.rules):
// the profile's org, an approved status, and a password that is the user's own
// (mustChangePassword not set). Site reach is functions/lib/audience.js
// reachesScope — the server copy of the app's resolveAccessibleSites — so the
// bot never shows a site the app would not.
// ─────────────────────────────────────────────────────────────────────────────
import { reachesScope, scopeFrom } from '../audience.js'

/** An approved, active member of `orgId`. */
export function isActiveMember(user, orgId) {
  if (!user || typeof user !== 'object' || !orgId) return false
  if (user.orgId !== orgId) return false
  if (user.status !== 'approved') return false
  if (user.mustChangePassword === true) return false
  return true
}

/** The subset of `sites` this profile reaches. Admins reach every site. */
export function reachableSites(user, sites = []) {
  return (sites || []).filter((site) => site && site.id && reachesScope(user, scopeFrom({}, site)))
}
