// ─────────────────────────────────────────────────────────────────────────────
// One welcome when a WhatsApp number becomes linked.
//
// Both writers of waLinks/{waId} — redeemLinkCode (the person sent LINK) and
// addOrgNumber (an administrator attached it) — replace the whole document.
// A Firestore trigger sees every one of those writes, including the ones that
// are not news: the administrator saving the same number again, a second LINK
// for a binding that already exists, the code path deleting an older handset.
// Welcoming each of those sent a second billable message, and welcoming from
// inside the transaction made a Graph refusal look like the link had failed.
//
// The decision is the binding, not the write. uid + orgId newly present, or
// pointing at someone else, is one welcome. The same pair written again is
// not. A code that does not redeem never writes waLinks, so it never arrives
// here. The send happens after the write has committed; a refusal is logged
// and the link stays.
//
// The ledger key is a keyed digest. The document id is the phone number, and
// the notifications row is not a place a number may be copied to — waLinks is
// the only collection that holds one. The claim is what stops a second
// delivery of the same event sending a second welcome.
// ─────────────────────────────────────────────────────────────────────────────
import { notificationId, sendOnce } from '../notify.js'
import { phoneHash } from './link.js'
import { normaliseWaId } from './parse.js'
import { clean } from './format.js'

export const LINK_WELCOME_KIND = 'whatsapp.link'

/** What the sentence says when the organisation has no usable name. */
export const WELCOME_ORG_FALLBACK = 'your organisation'

const WELCOME_BEFORE = 'Welcome! You are now linked to '
const WELCOME_AFTER =
  ' Safety through WhatsApp. Send the Center ID, Center Name, or Location to get the details.'

function snapshotExists(snap) {
  if (!snap) return false
  return typeof snap.exists === 'function' ? Boolean(snap.exists()) : Boolean(snap.exists)
}

async function readDoc(db, path) {
  const snap = await db.doc(path).get()
  if (!snapshotExists(snap)) return null
  const data = typeof snap.data === 'function' ? snap.data() : null
  return data || {}
}

/** An id that can sit in one path segment. `.` and `..` are segments, not a search. */
function pathSegment(value) {
  if (typeof value !== 'string') return ''
  const id = value.trim()
  if (!id || id === '.' || id === '..' || id.includes('/')) return ''
  return id
}

/**
 * A uid and orgId that can be a waLinks binding. A slash would change which
 * document the name is read from once it is concatenated into a path.
 */
export function linkIdentity(data) {
  if (!data || typeof data !== 'object') return null
  const uid = pathSegment(data.uid)
  const orgId = pathSegment(data.orgId)
  if (!uid || !orgId) return null
  return { uid, orgId }
}

/**
 * Stable identity of this write's link, for the ledger. A retry of the same
 * write must hash the same way; a later link (new linkedAt) must not.
 * Empty when the writers forgot a timestamp — the binding alone then dedupes,
 * which can suppress a re-link that also has no timestamp. Both writers set one.
 */
export function linkStamp(data) {
  if (!data || typeof data !== 'object') return ''
  const ms = Number(data.linkedAtMs)
  if (Number.isFinite(ms) && ms > 0) return String(Math.trunc(ms))
  const linkedAt = data.linkedAt
  if (linkedAt && typeof linkedAt.toMillis === 'function') {
    const v = Number(linkedAt.toMillis())
    if (Number.isFinite(v) && v > 0) return String(Math.trunc(v))
  }
  if (linkedAt instanceof Date && Number.isFinite(linkedAt.getTime()) && linkedAt.getTime() > 0) {
    return String(linkedAt.getTime())
  }
  const seconds = Number(linkedAt?.seconds ?? linkedAt?._seconds)
  if (Number.isFinite(seconds) && seconds > 0) {
    const nanos = Number(linkedAt?.nanoseconds ?? linkedAt?._nanoseconds) || 0
    return String(seconds * 1000 + Math.floor(nanos / 1e6))
  }
  return ''
}

/**
 * Send only when this write establishes a binding the previous document did
 * not already hold. Same uid and orgId is a re-save, whatever else changed.
 */
export function planLinkWelcome(before, after) {
  const next = linkIdentity(after)
  if (!next) return { send: false, reason: 'not-a-link' }
  const prev = linkIdentity(before)
  if (prev && prev.uid === next.uid && prev.orgId === next.orgId) {
    return { send: false, reason: 'resave' }
  }
  return { send: true, ...next, stamp: linkStamp(after) }
}

/**
 * The name the welcome may say. The live organisation document wins; the
 * copy on the profile is what signup stored and is only a fallback. Sealed
 * values and WhatsApp formatting markers are dropped, so a name cannot
 * restyle the sentence or become a second line.
 */
export function organisationLabel(orgName, profileName) {
  return clean(orgName, 80) || clean(profileName, 80) || WELCOME_ORG_FALLBACK
}

/**
 * The one text. `label` is a raw name or an organisationLabel. Joined rather
 * than replaced: a name of "$&" must not be reread as the matched pattern.
 */
export function welcomeText(label) {
  return WELCOME_BEFORE + organisationLabel(label) + WELCOME_AFTER
}

/** Ledger key. The phone number is inside the digest, not beside it. */
export function linkWelcomeKey(pepper, waId, uid, orgId, stamp) {
  const digest = phoneHash(pepper, [waId, uid, orgId, stamp].join('\u001f'))
  return [LINK_WELCOME_KIND, digest]
}

function noopLogger() {
  return { info() {}, error() {} }
}

/**
 * Send the welcome for one waLinks write, or decide not to.
 * Does not throw when Graph refuses: the link is already stored, and a throw
 * here is how a trigger retry becomes a second message after a send that
 * actually landed. A failure to claim the ledger still throws — nothing was
 * sent, and the caller decides whether that is retried.
 *
 * @param send (waId, text) => { ok, status?, error? }
 * @param reserveOutbound () => boolean   the global daily cap; omitted in tests
 *        that are not about the cap. Called only after this event wins the claim.
 */
export async function deliverLinkWelcome({
  db,
  waId,
  before,
  after,
  send,
  logger,
  now = new Date(),
  pepper,
  configured = false,
  reserveOutbound,
} = {}) {
  const log = logger || noopLogger()
  const plan = planLinkWelcome(before, after)
  if (!plan.send) return { status: 'skipped', reason: plan.reason }

  const to = normaliseWaId(waId)
  if (!to || to !== String(waId)) {
    log.error('whatsapp link welcome: number is not a wa id', {
      orgId: plan.orgId,
      uid: plan.uid,
    })
    return { status: 'skipped', reason: 'bad-number' }
  }

  // No claim yet. A placeholder token must not occupy the ledger: the write
  // will not be delivered again when the operator turns WhatsApp on.
  if (!configured || !pepper || typeof send !== 'function') {
    log.error('whatsapp link welcome is not configured', { orgId: plan.orgId, uid: plan.uid })
    return { status: 'skipped', reason: 'not-configured' }
  }

  let orgName = ''
  try {
    const org = await readDoc(db, `organizations/${plan.orgId}`)
    orgName = org?.name
  } catch (err) {
    log.error('whatsapp link welcome: organisation name unreadable', {
      orgId: plan.orgId,
      uid: plan.uid,
      error: err?.message || String(err),
    })
  }
  let profileName = ''
  if (!clean(orgName, 80)) {
    try {
      const profile = await readDoc(db, `users/${plan.uid}`)
      profileName = profile?.orgName
    } catch (err) {
      log.error('whatsapp link welcome: profile organisation name unreadable', {
        orgId: plan.orgId,
        uid: plan.uid,
        error: err?.message || String(err),
      })
    }
  }
  const text = welcomeText(organisationLabel(orgName, profileName))
  const key = linkWelcomeKey(pepper, to, plan.uid, plan.orgId, plan.stamp)
  const ref = db.doc(`organizations/${plan.orgId}/notifications/${notificationId(key)}`)

  const outcome = await sendOnce({
    ref,
    kind: LINK_WELCOME_KIND,
    key,
    uid: plan.uid,
    subject: text,
    now,
    send: async () => {
      if (typeof reserveOutbound === 'function') {
        const allowed = await reserveOutbound()
        if (!allowed) {
          const err = new Error('outbound cap')
          err.code = 'outbound-cap'
          throw err
        }
      }
      const result = await send(to, text)
      if (!result?.ok) {
        const err = new Error('whatsapp send failed')
        err.code = result?.error || 'wa-send'
        err.status = result?.status
        throw err
      }
    },
  })

  if (outcome.status === 'sent') {
    log.info('whatsapp link welcome sent', { orgId: plan.orgId, uid: plan.uid })
  } else if (outcome.status === 'failed') {
    // code and reason only. error.message is where a client would put the
    // request URL, and that URL contains the phone number.
    log.error('whatsapp link welcome failed', {
      orgId: plan.orgId,
      uid: plan.uid,
      reason: outcome.reason,
      error: outcome.error?.code,
      status: outcome.error?.status,
    })
  }
  return outcome
}
