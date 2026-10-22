// ─────────────────────────────────────────────────────────────────────────────
// Firestore side of Org Settings → Connect with WhatsApp.
//
// Every function starts from the caller's own users/{uid} profile. There is
// no organisation id argument: a profile in org A cannot read or write org B's
// numbers by naming it. waLinks and waOrgSettings stay server-only in the
// rules; this module is the admin path, and it runs with the Admin SDK.
//
// Phone numbers are personal data. They are returned only to an approved
// admin of the organisation the link belongs to, and the audit line the
// client writes records the last four digits — the audit log is readable by
// every member, so the full number does not belong in it.
// ─────────────────────────────────────────────────────────────────────────────
import { maskPhone } from './link.js'
import { countOutbound } from './rateLimit.js'
import {
  allowOrgTest,
  orgLookupEnabled,
  planAddLink,
  planRemoveLink,
  presentConnect,
  requireOrgAdmin,
  testMessageText,
  normalizeWaId,
} from './orgConnect.js'

const MEMBER_SCAN_CAP = 20000
const LINK_LIST_CAP = 200

function take(snap, cap) {
  const docs = snap?.docs || []
  return { docs: docs.slice(0, cap), truncated: docs.length >= cap || snap?.size >= cap }
}

async function loadChosen(db, uid) {
  if (!uid) return null
  const snap = await db.doc(`users/${uid}`).get()
  if (!snap.exists) return null
  // uid last: a profile field named uid must not impersonate another account.
  return { ...(snap.data() || {}), uid }
}

async function orgMembers(db, orgId) {
  let q = db.collection('users').where('orgId', '==', orgId)
  if (typeof q.limit === 'function') q = q.limit(MEMBER_SCAN_CAP)
  const snap = await q.get()
  const { docs, truncated } = take(snap, MEMBER_SCAN_CAP)
  return {
    members: docs.map((d) => ({ ...(d.data() || {}), uid: d.id })),
    truncated,
  }
}

/** Status for the caller's organisation. No secrets, no other tenant's rows. */
export async function readOrgConnect(db, { user, platformReady = false, displayNumber = '' } = {}) {
  const gate = requireOrgAdmin(user)
  if (!gate.ok) return gate

  let linkQuery = db.collection('waLinks').where('orgId', '==', gate.orgId)
  if (typeof linkQuery.limit === 'function') linkQuery = linkQuery.limit(LINK_LIST_CAP)
  const [settingsSnap, linkSnap] = await Promise.all([
    db.doc(`waOrgSettings/${gate.orgId}`).get(),
    linkQuery.get(),
  ])
  const { docs, truncated } = take(linkSnap, LINK_LIST_CAP)
  const uids = [
    ...new Set(
      docs
        .map((d) => d.data()?.uid)
        .filter((uid) => typeof uid === 'string' && uid && !uid.includes('/'))
    ),
  ]
  const membersByUid = new Map()
  await Promise.all(
    uids.map(async (uid) => {
      const member = await loadChosen(db, uid)
      if (member) membersByUid.set(uid, member)
    })
  )
  const links = docs.map((d) => ({ id: d.id, ...(d.data() || {}) }))
  return {
    ok: true,
    ...presentConnect({
      platformReady,
      displayNumber,
      settings: settingsSnap.exists ? settingsSnap.data() || {} : null,
      links,
      membersByUid,
      truncated,
    }),
  }
}

/** Turn lookup on or off. Merge, so a test-rate window on the same doc survives. */
export async function setOrgEnabled(db, { user, enabled, now = new Date() } = {}) {
  const gate = requireOrgAdmin(user)
  if (!gate.ok) return gate
  if (enabled !== true && enabled !== false) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'Say whether WhatsApp lookup should be on or off.',
    }
  }
  await db
    .doc(`waOrgSettings/${gate.orgId}`)
    .set({ enabled, updatedBy: gate.uid, updatedAtMs: now.getTime() }, { merge: true })
  return { ok: true, enabled }
}

/**
 * Bind a handset to an approved member. One number per person: an older
 * handset for that member is removed, same as redeeming a link code.
 * A number already tied to someone else is left where it is.
 */
export async function addOrgNumber(
  db,
  {
    user,
    phone,
    memberUid,
    now = new Date(),
    stamp = (d) => ({ toMillis: () => d.getTime() }),
  } = {}
) {
  const gate = requireOrgAdmin(user)
  if (!gate.ok) return gate

  const named = memberUid == null || memberUid === '' ? '' : memberUid
  if (named && (typeof named !== 'string' || named.includes('/') || named.length > 128)) {
    return { ok: false, code: 'invalid-argument', message: 'Choose an employee from the list.' }
  }
  const chosen = named ? await loadChosen(db, named) : null
  const scanned = named ? { members: [], truncated: false } : await orgMembers(db, gate.orgId)
  const waId = normalizeWaId(phone)
  const existingSnap = waId ? await db.doc(`waLinks/${waId}`).get() : null
  const existingPhone = existingSnap?.exists ? existingSnap.data() || {} : null

  const plan = planAddLink({
    phone,
    memberUid: named,
    members: scanned.members,
    chosen,
    existingPhone,
    orgId: gate.orgId,
    memberScanTruncated: scanned.truncated,
  })
  if (!plan.ok) return plan

  const link = {
    uid: plan.uid,
    orgId: gate.orgId,
    last4: plan.waId.slice(-4),
    linkedAt: stamp(now),
    linkedAtMs: now.getTime(),
    source: 'admin',
    linkedBy: gate.uid,
  }

  // Re-read inside the transaction. Two admins adding the same number must
  // not each believe they won, and a link that landed for another organisation
  // between the read above and this write must not be overwritten.
  const claimed = await db.runTransaction(async (tx) => {
    const ref = db.doc(`waLinks/${plan.waId}`)
    const snap = await tx.get(ref)
    const current = snap.exists ? snap.data() || {} : null
    if (current?.orgId && current.orgId !== gate.orgId) {
      return {
        ok: false,
        code: 'already-exists',
        message: 'That number is already linked elsewhere and cannot be added.',
      }
    }
    if (current?.orgId === gate.orgId && current.uid && current.uid !== plan.uid) {
      return {
        ok: false,
        code: 'already-exists',
        message:
          'That number is already linked to someone else in your organisation. Remove it first.',
      }
    }
    tx.set(ref, link)
    return { ok: true }
  })
  if (!claimed.ok) return claimed

  const others = await db.collection('waLinks').where('uid', '==', plan.uid).get()
  await Promise.all(
    (others.docs || []).filter((d) => d.id !== plan.waId).map((d) => d.ref.delete())
  )

  return { ok: true, phone: plan.waId, masked: plan.masked, uid: plan.uid, mapped: plan.mapped }
}

export async function removeOrgNumber(db, { user, phone } = {}) {
  const gate = requireOrgAdmin(user)
  if (!gate.ok) return gate
  const waId = normalizeWaId(phone)
  const snap = waId ? await db.doc(`waLinks/${waId}`).get() : null
  const plan = planRemoveLink({
    phone,
    existing: snap?.exists ? snap.data() || {} : null,
    orgId: gate.orgId,
  })
  if (!plan.ok) return plan
  await db.doc(`waLinks/${plan.waId}`).delete()
  return { ok: true, masked: plan.masked }
}

/**
 * Reserve a test send to a number already linked to this organisation.
 * Does not call Graph — the caller holds the token and is the only one that
 * should. The text is built here from the organisation's own name, not from
 * anything the browser sent.
 */
export async function prepareOrgTest(db, { user, phone, now = new Date(), dailyCap = 2000 } = {}) {
  const gate = requireOrgAdmin(user)
  if (!gate.ok) return gate
  const waId = normalizeWaId(phone)
  if (!waId) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'Choose a linked number to send the test to.',
    }
  }
  const linkSnap = await db.doc(`waLinks/${waId}`).get()
  const link = linkSnap.exists ? linkSnap.data() || {} : null
  if (!link || link.orgId !== gate.orgId) {
    return {
      ok: false,
      code: 'not-found',
      message: 'Tests are sent only to a number linked to your organisation.',
    }
  }

  const settingsRef = db.doc(`waOrgSettings/${gate.orgId}`)
  const limited = await db.runTransaction(async (tx) => {
    const snap = await tx.get(settingsRef)
    const prev = snap.exists ? snap.data() || {} : {}
    const gateTest = allowOrgTest(prev, now)
    if (!gateTest.allowed) {
      return {
        ok: false,
        code: 'resource-exhausted',
        message: 'Too many test messages. Wait a while and try again.',
      }
    }
    tx.set(settingsRef, gateTest.state, { merge: true })
    return { ok: true, enabled: orgLookupEnabled(prev) }
  })
  if (!limited.ok) return limited

  const capRef = db.doc('waRate/outbound-global')
  const outbound = await db.runTransaction(async (tx) => {
    const snap = await tx.get(capRef)
    const out = countOutbound(snap.exists ? snap.data() || {} : {}, now, dailyCap)
    tx.set(capRef, out.state)
    return out
  })
  if (!outbound.allowed) {
    return {
      ok: false,
      code: 'resource-exhausted',
      message: 'WhatsApp replies are paused for today. Try again tomorrow.',
    }
  }

  const orgSnap = await db.doc(`organizations/${gate.orgId}`).get()
  const orgName = orgSnap.exists ? orgSnap.data()?.name : ''
  return {
    ok: true,
    waId,
    masked: maskPhone(waId),
    text: testMessageText(orgName, limited.enabled),
  }
}
