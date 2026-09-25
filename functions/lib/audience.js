// Who a site-scoped mail is allowed to reach.
//
// There is no "site admin" role. The membership that can see a site is the
// one resolveAccessibleSites (src/shared/auth/access.js) and reachesSite
// (firestore.rules) already use:
//
//   • role === 'admin'           every site in the org
//   • users.siteId               the person's own posting
//   • access.sites               explicit site grants
//   • access.regions             every site in that region
//   • access.entities            every site in that entity
//
// A manager, auditor or member is not elevated. They are included only when a
// grant reaches the record. An empty string is not a grant: a profile carrying
// '' in regions would otherwise match every site that has no region stored.
//
// When the record names no site, region or entity, only org admins match.
// Mailing every approved member would send one plant's defect to every other
// plant. Incident reads are org-wide for the same reason this is not.
import { readableText } from './mailTemplates/safe.js'

// One document write, or one scheduled org, becoming an unbounded number of
// SMTP calls is a bill and a timeout. 100 is the same cap assignment mail
// uses. The overflow is logged and not sent; it is not retried, because the
// write will not be delivered again.
export const CIRCULATION_CAP = 100

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function text(value) {
  return readableText(value).trim()
}

/** Non-empty strings only. '' is not a grant. */
export function grantList(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
}

/**
 * The scope a record is filed at. `site` is the site document, used when the
 * record stores a siteId but not the region or entity — a region grant would
 * otherwise miss a site that only recorded its id.
 */
export function scopeFrom(record, site) {
  return {
    siteId: text(record?.siteId) || text(site?.id) || '',
    region: text(record?.region) || text(record?.siteRegion) || text(site?.region) || '',
    entity: text(record?.entity) || text(record?.siteEntity) || text(site?.entity) || '',
    siteName:
      text(record?.centerName) || text(record?.site) || text(site?.name) || text(site?.code) || '',
  }
}

/** Whether this profile's grants reach `scope`. Admins reach every scope. */
export function reachesScope(user, scope = {}) {
  if (!user || typeof user !== 'object') return false
  if (user.role === 'admin') return true
  const siteId = text(scope.siteId)
  const region = text(scope.region)
  const entity = text(scope.entity)
  if (!siteId && !region && !entity) return false
  if (siteId && text(user.siteId) === siteId) return true
  const access = user.access && typeof user.access === 'object' ? user.access : {}
  if (siteId && grantList(access.sites).includes(siteId)) return true
  if (region && grantList(access.regions).includes(region)) return true
  if (entity && grantList(access.entities).includes(entity)) return true
  return false
}

/**
 * An address this function may send to, or null.
 * Tenancy is the profile's orgId. pending / rejected / suspended are not
 * people who can open the link. A missing status is a profile from before
 * the field existed, same as assignment mail.
 */
export function recipientAddress(user, orgId) {
  if (!user || typeof user !== 'object') return null
  if (user.orgId !== orgId) return null
  if (user.status && user.status !== 'approved') return null
  const email = typeof user.email === 'string' ? user.email.trim() : ''
  if (!EMAIL_RE.test(email)) return null
  const uid = typeof user.uid === 'string' ? user.uid.trim() : ''
  if (!uid || uid === '.' || uid === '..' || uid.includes('/')) return null
  return { uid, email }
}

/**
 * One row per mailbox. Query order is not stable, so the survivor is the
 * lowest uid: a retry must claim the same ledger row, not the other profile
 * that shares the address.
 */
export function dedupeByEmail(rows) {
  const sorted = [...rows].sort((a, b) => a.uid.localeCompare(b.uid))
  const seen = new Set()
  const out = []
  for (const row of sorted) {
    const key = row.email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

/**
 * The profile `token` names, or null.
 * A uid matches that profile. An email matches that mailbox. A display name
 * matches only when exactly one addressable member carries it: internal
 * permit participants and a drill's loggedBy are stored as names, and two
 * people who share one are not a guess. readableText drops a sealed value,
 * so ciphertext does not match anyone.
 */
export function addressForToken(users, orgId, token) {
  const raw = text(token)
  if (!raw) return null
  const list = users || []
  const byUid = list.find((user) => user && text(user.uid) === raw)
  if (byUid) return recipientAddress(byUid, orgId)
  if (EMAIL_RE.test(raw)) {
    const hits = list
      .map((user) => recipientAddress(user, orgId))
      .filter((addr) => addr && addr.email.toLowerCase() === raw.toLowerCase())
    return hits.length === 1 ? hits[0] : null
  }
  const named = list.filter((user) => {
    if (!user || text(user.name).toLowerCase() !== raw.toLowerCase()) return false
    return Boolean(recipientAddress(user, orgId))
  })
  if (named.length !== 1) return null
  return recipientAddress(named[0], orgId)
}

/** Scoped rows plus extra addresses. One mailbox, lowest uid. */
export function unionAddresses(rows, extra) {
  return dedupeByEmail([...(rows || []), ...(extra || []).filter(Boolean)])
}

/** Org admins plus members whose grants reach `scope`. */
export function selectScopedAudience(users, orgId, scope) {
  const rows = []
  for (const user of users || []) {
    const addr = recipientAddress(user, orgId)
    if (!addr) continue
    if (!reachesScope(user, scope)) continue
    rows.push(addr)
  }
  return dedupeByEmail(rows)
}

/** Every approved member of this org with an address. Not cross-tenant. */
export function selectActiveAudience(users, orgId) {
  const rows = []
  for (const user of users || []) {
    const addr = recipientAddress(user, orgId)
    if (!addr) continue
    rows.push(addr)
  }
  return dedupeByEmail(rows)
}

/**
 * Approved, active admins of this org, one row per mailbox.
 *
 * The profile stores one role string. `admin` reaches every site in the org.
 * There is no site, entity or region admin role beside it — a grant on a
 * manager or a member is how that person sees a plant, and it is not this
 * list. selectActiveAudience is every approved member. The weather digest
 * used to call that, so a mail that names every elevated plant went to people
 * who cannot open those plants.
 *
 * Suspended, pending and rejected profiles are dropped by recipientAddress.
 * A missing status is a profile from before the field existed, same as the
 * other mail. The survivor of a shared mailbox is the lowest uid, so a retry
 * claims the same ledger row.
 */
export function selectAdminAudience(users, orgId) {
  const rows = []
  for (const user of users || []) {
    if (!user || user.role !== 'admin') continue
    const addr = recipientAddress(user, orgId)
    if (!addr) continue
    rows.push(addr)
  }
  return dedupeByEmail(rows)
}

export async function loadOrgUsers(db, orgId) {
  const snap = await db.collection('users').where('orgId', '==', orgId).get()
  return snap.docs.map((d) => ({ uid: d.id, ...(d.data() || {}) }))
}

export async function loadDoc(db, path) {
  const snap = await db.doc(path).get()
  const exists = typeof snap.exists === 'function' ? snap.exists() : Boolean(snap.exists)
  if (!exists) return null
  const data = typeof snap.data === 'function' ? snap.data() : null
  if (!data) return null
  return { id: snap.id, ...data }
}
