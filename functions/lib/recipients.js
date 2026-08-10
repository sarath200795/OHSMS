// ─────────────────────────────────────────────────────────────────────────────
// Who gets the email.
//
// This is the part of a notification system that does real harm when it is
// sloppy. Most records in this app name their owner as FREE TEXT — "Ravi",
// "R. Kumar", "safety team" — because they predate any user picker. Only the
// newer shapes (drill CAPA assignees, training assignments) carry a uid.
//
// So the rule here is: notify confidently, or not at all. A uid is proof. A
// name that matches exactly one person in the org is good enough. A name that
// matches two people, or none, sends NOTHING — because emailing the wrong
// person about someone else's incident is worse than emailing no one, and it is
// the kind of wrong that is never noticed by the sender.
//
// Everything in this file is pure so the matching rules can be tested without
// Firestore, which is where the judgement actually lives.
// ─────────────────────────────────────────────────────────────────────────────

const norm = (s) => String(s ?? '').trim().toLowerCase()

/** Can this user be emailed at all? */
export const isReachable = (u) =>
  Boolean(u && u.email && u.status === 'approved' && u.notificationsEnabled !== false)

/**
 * Resolve one owner reference to a user.
 *
 * @param ref   { uid?, name?, email? } — whatever the record carried
 * @param users the org's users
 * @returns { uid, email, name, confidence } or null
 */
export function resolveRecipient(ref, users = []) {
  if (!ref) return null
  const pool = users.filter(isReachable)

  // 1. A uid is unambiguous.
  if (ref.uid) {
    const byUid = pool.find((u) => u.uid === ref.uid)
    return byUid ? pick(byUid, 'uid') : null
  }

  // 2. An email is too, and is worth trusting over a name.
  if (ref.email) {
    const byEmail = pool.find((u) => norm(u.email) === norm(ref.email))
    return byEmail ? pick(byEmail, 'email') : null
  }

  // 3. A name only counts when exactly one person answers to it.
  const wanted = norm(ref.name)
  if (!wanted) return null
  const byName = pool.filter((u) => norm(u.name) === wanted)
  if (byName.length === 1) return pick(byName[0], 'name')

  // Two Ravis, or none: say nothing rather than guess.
  return null
}

const pick = (u, confidence) => ({ uid: u.uid, email: u.email, name: u.name || u.email, confidence })

/**
 * Resolve many references, de-duplicated by uid.
 *
 * Duplicates are ordinary — the same person can be the owner of an action and a
 * member of the team it belongs to — and nobody should get the same email twice
 * because of it.
 */
export function resolveRecipients(refs = [], users = []) {
  const out = new Map()
  for (const ref of refs) {
    const r = resolveRecipient(ref, users)
    if (r && !out.has(r.uid)) out.set(r.uid, r)
  }
  return [...out.values()]
}

/**
 * Everyone who should hear about something org-wide, by role.
 *
 * Used for events with no named owner — an incident is reported, an unsafe
 * observation arrives from a QR scan — where the right audience is "whoever
 * runs safety here" rather than one person.
 */
export function resolveByRole(users = [], roles = ['admin']) {
  const want = new Set(roles)
  return users.filter(isReachable).filter((u) => want.has(u.role)).map((u) => pick(u, 'role'))
}

/**
 * Narrow a recipient list to people who can see a site.
 *
 * A notification is a read: telling someone an incident happened at a site they
 * have no access to leaks that it happened at all. Admins see everything, which
 * matches how the app scopes every other read.
 */
export function limitToSite(recipients = [], users = [], siteId) {
  if (!siteId) return recipients
  const byUid = new Map(users.map((u) => [u.uid, u]))
  return recipients.filter((r) => {
    const u = byUid.get(r.uid)
    if (!u) return false
    if (u.role === 'admin') return true
    const access = u.access || {}
    const sites = Array.isArray(access.sites) ? access.sites : []
    return u.siteId === siteId || sites.includes(siteId)
  })
}
