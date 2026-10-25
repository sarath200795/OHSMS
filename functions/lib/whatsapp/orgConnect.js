// ─────────────────────────────────────────────────────────────────────────────
// Org Settings → Connect with WhatsApp. Decisions only: no Firestore, no
// token, no Graph call. orgAdmin.js performs the reads and writes; index.js
// is the only place that sees WA_ACCESS_TOKEN, and it never puts that value
// on a return path.
//
// The shared business number is one for the whole deployment. Each
// organisation turns lookup on or off for itself, and names which of its
// members' handsets may ask. A handset is bound to that member, so the reply
// is still only the sites that member reaches — an admin typing a number does
// not promote the handset to admin unless the member already is one.
//
// Absent waOrgSettings means lookup stays on. The bot already answered linked
// numbers before the switch existed; deploying the switch must not silence
// them. Only an explicit enabled: false turns an organisation off.
// ─────────────────────────────────────────────────────────────────────────────
import { isActiveMember } from './access.js'
import { clean } from './format.js'
import { maskPhone } from './link.js'
import { canonicalWaId } from './phones.js'

export const ORG_TEST_LIMIT = 5
export const ORG_TEST_WINDOW_MS = 60 * 60 * 1000

// Profile fields an organisation might already hold a mobile number in.
// Matching is exact after formatting is stripped, so a sentence that merely
// contains the digits does not bind the wrong person.
const PHONE_FIELDS = ['phone', 'mobile', 'whatsapp', 'phoneNumber']

function fail(code, message) {
  return { ok: false, code, message }
}

/**
 * WhatsApp's wa_id, or null. See phones.js: an Indian mobile is stored the
 * way Meta sends `from` (`9177…`), including when the admin typed a `+`,
 * a trunk `0`, or the ten digits alone. Anything that is not a handset is
 * null rather than a guess at some other country.
 */
export function normalizeWaId(input) {
  return canonicalWaId(input) || null
}

/** Click-to-chat for the shared number. Null when the display param is not a number. */
export function clickToChatLink(displayNumber) {
  const waId = normalizeWaId(displayNumber)
  return waId ? `https://wa.me/${waId}` : null
}

/** Missing document, or any value other than boolean false, leaves lookup on. */
export function orgLookupEnabled(data) {
  if (!data || typeof data !== 'object') return true
  return data.enabled !== false
}

export function memberPhoneMatches(member, waId) {
  if (!member || !waId) return false
  return PHONE_FIELDS.some((field) => {
    const raw = member[field]
    if (raw == null || typeof raw === 'object') return false
    return normalizeWaId(raw) === waId
  })
}

export function membersMatchingPhone(members, waId) {
  const seen = new Set()
  const hits = []
  for (const member of members || []) {
    const uid = member?.uid
    if (!uid || seen.has(uid) || !memberPhoneMatches(member, waId)) continue
    seen.add(uid)
    hits.push(member)
  }
  return hits
}

/**
 * The signed-in profile may administer its own organisation. The organisation
 * id is the one on that profile — callers do not pass one.
 */
export function requireOrgAdmin(user) {
  if (
    !user ||
    typeof user !== 'object' ||
    user.role !== 'admin' ||
    !isActiveMember(user, user.orgId)
  ) {
    return fail('permission-denied', 'Organisation administrators only.')
  }
  return { ok: true, orgId: user.orgId, uid: user.uid }
}

function namedUid(memberUid) {
  if (memberUid == null || memberUid === '') return ''
  if (typeof memberUid !== 'string' || memberUid.includes('/') || memberUid.length > 128)
    return null
  return memberUid
}

/**
 * Whether this admin may bind `phone` to a member of `orgId`.
 * `chosen` is users/{uid} when the admin named someone.
 * `members` is the org's profiles, used only when they did not.
 * `existingPhone` is the waLinks row for that number, if one exists.
 */
export function planAddLink({
  phone,
  memberUid,
  members,
  chosen,
  existingPhone,
  orgId,
  memberScanTruncated = false,
}) {
  const waId = normalizeWaId(phone)
  if (!waId) {
    return fail('invalid-argument', 'Enter a WhatsApp number with the country code, digits only.')
  }
  const named = namedUid(memberUid)
  if (named == null) return fail('invalid-argument', 'Choose an employee from the list.')

  let member = null
  let mapped = 'chosen'
  if (named) {
    const uid = chosen?.uid
    if (!chosen || uid !== named || chosen.orgId !== orgId) {
      return fail('invalid-argument', 'That person is not in your organisation.')
    }
    if (!isActiveMember(chosen, orgId)) {
      return fail('failed-precondition', 'That person is not an approved member yet.')
    }
    member = chosen
  } else {
    if (memberScanTruncated) {
      return fail(
        'invalid-argument',
        'Choose the employee. The organisation is too large to match a number on its own.'
      )
    }
    const hits = membersMatchingPhone(members, waId).filter((m) => isActiveMember(m, orgId))
    if (hits.length > 1) {
      return fail('invalid-argument', 'Several employees have this number. Choose one.')
    }
    if (hits.length === 0) {
      return fail(
        'invalid-argument',
        'Choose the employee this number belongs to. No approved profile has this number.'
      )
    }
    member = hits[0]
    mapped = 'phone'
  }

  if (existingPhone && existingPhone.orgId && existingPhone.orgId !== orgId) {
    return fail('already-exists', 'That number is already linked elsewhere and cannot be added.')
  }
  if (
    existingPhone &&
    existingPhone.orgId === orgId &&
    existingPhone.uid &&
    existingPhone.uid !== member.uid
  ) {
    return fail(
      'already-exists',
      'That number is already linked to someone else in your organisation. Remove it first.'
    )
  }

  return {
    ok: true,
    waId,
    uid: member.uid,
    mapped,
    masked: maskPhone(waId),
  }
}

/** Removal only of a number that is actually linked to this organisation. */
export function planRemoveLink({ phone, existing, orgId }) {
  const waId = normalizeWaId(phone)
  if (!waId) return fail('invalid-argument', 'Enter the WhatsApp number to remove.')
  if (!existing || existing.orgId !== orgId) {
    return fail('not-found', 'That number is not linked to your organisation.')
  }
  return {
    ok: true,
    waId,
    masked: maskPhone(waId),
    uid: typeof existing.uid === 'string' ? existing.uid : null,
  }
}

function linkMillis(row) {
  const stamped = row?.linkedAt
  if (stamped && typeof stamped.toMillis === 'function') {
    const ms = stamped.toMillis()
    return Number.isFinite(ms) ? ms : null
  }
  const ms = Number(row?.linkedAtMs)
  return Number.isFinite(ms) && ms > 0 ? ms : null
}

/**
 * The status payload. Built by naming every field, so a token stuffed into
 * the settings document cannot ride back to the browser.
 */
export function presentConnect({
  platformReady,
  displayNumber,
  settings,
  links,
  membersByUid,
  truncated = false,
}) {
  const chatLink = clickToChatLink(displayNumber)
  const list = (links || []).map((row) => {
    const phone = String(row.id || row.phone || '')
    const uid = typeof row.uid === 'string' ? row.uid : null
    const member = uid && membersByUid?.get ? membersByUid.get(uid) : null
    return {
      phone,
      masked: maskPhone(phone),
      uid,
      active: Boolean(member && isActiveMember(member, row.orgId)),
      linkedAt: linkMillis(row),
      source: row.source === 'admin' ? 'admin' : 'self',
    }
  })
  list.sort((a, b) => a.phone.localeCompare(b.phone))
  return {
    platformReady: platformReady === true,
    number: chatLink ? String(displayNumber).trim() : null,
    chatLink,
    enabled: orgLookupEnabled(settings),
    links: list,
    truncated: truncated === true,
  }
}

/** One test per send, capped per organisation per hour. The previous fields are kept. */
export function allowOrgTest(state = {}, now = new Date()) {
  const t = now.getTime()
  const start = Number(state.testWindowStartMs) || 0
  const inWindow = start > 0 && t - start < ORG_TEST_WINDOW_MS
  const count = inWindow ? Number(state.testCount) || 0 : 0
  if (count >= ORG_TEST_LIMIT) {
    return { allowed: false, state: { ...state, testWindowStartMs: start, testCount: count } }
  }
  return {
    allowed: true,
    state: {
      ...state,
      testWindowStartMs: inWindow ? start : t,
      testCount: count + 1,
    },
  }
}

/** Body of the admin's test send. No site data, and the org name cannot restyle it. */
export function testMessageText(orgName, enabled) {
  const name = clean(orgName, 80) || 'your organisation'
  const line = enabled
    ? `WhatsApp site lookup is on for ${name}. Send a Site ID or Centre ID, or part of a site name.`
    : `WhatsApp site lookup is switched off for ${name}. This message only checks that the number can receive a message.`
  return `${line}\n\nIn an emergency call 112.`
}
