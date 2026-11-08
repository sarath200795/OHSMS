// Adding people to a dedicated environment.
//
// A first sign-in is admitted only against an invite (stack/identity.mjs), and
// until this file the only invite ever written was the founder's, at
// fulfillment. Everyone else the company's IdP authenticated was told there
// was no account on this organization, so a dedicated environment was a
// one-person environment. The Employees page could not help: it creates WEEHS
// Firebase accounts, which this stack does not have.
//
// Being authenticated by the company's IdP says who someone is. It does not
// say they belong in this tenant, or with what role — an IdP usually holds the
// whole company, contractors included. That decision is an admin's, and this
// is where they make it.
//
// Every call re-reads the caller's live profile. A session token proves who
// signed in, not that they are still an approved admin (the S-19 reasoning in
// storage.rules): an admin demoted a minute ago must not invite anyone.
//
// invites is FORCE ROW LEVEL SECURITY with no browser grant, so these run as
// the worker role, and the decisions below are the whole of the enforcement.

import { asWorker } from './engine.mjs'

const WORKER = { role: 'ohsms_worker', uid: '' }

// The four roles the product knows (src/shared/auth/permissions.js ROLES).
export const INVITE_ROLES = ['admin', 'manager', 'member', 'auditor']
export const MAX_PENDING_INVITES = 500

const EMAIL = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:]+$/

function refuse(reason) {
  return { ok: false, reason }
}

export function normalizeEmail(value) {
  // A string or nothing: String(['a@b.c']) is 'a@b.c', and a JSON body can
  // carry any shape.
  if (typeof value !== 'string') return ''
  const email = value.trim().toLowerCase()
  return email.length <= 254 && EMAIL.test(email) ? email : ''
}

function cleanName(value) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

/** The caller, if they are an approved admin who has cleared the password gate. */
async function adminOf(engine, uid) {
  if (!uid) return null
  const profile = await engine.get(WORKER, 'users', uid)
  if (!profile || profile.status !== 'approved' || profile.mustChangePassword === true) return null
  if (profile.role !== 'admin' || typeof profile.orgId !== 'string' || !profile.orgId) return null
  return profile
}

/**
 * Invite `email` into the caller's organization with `role`.
 * Re-inviting a pending address in the same organization updates it.
 * @returns {{ ok: true, email, role, emailed: boolean } | { ok: false, reason }}
 */
export async function inviteMember(
  engine,
  db,
  { uid, email, role, name, mail = null, origin = '' }
) {
  const admin = await adminOf(engine, uid)
  if (!admin) return refuse('not-admin')
  const address = normalizeEmail(email)
  if (!address) return refuse('email')
  if (!INVITE_ROLES.includes(role)) return refuse('role')
  const label = cleanName(name) || address

  // Already a member, of this organization or any other on this host: their
  // role is changed on the Employees page, not by a second invite.
  const member = await asWorker(
    db,
    `SELECT 1 FROM documents WHERE path = 'users' AND lower(data->>'email') = $1 LIMIT 1`,
    [address]
  )
  if (member.rows.length) return refuse('already-member')

  // An address pending for another organization is not this admin's to
  // redirect: the ON CONFLICT below would otherwise move it, and that person's
  // first sign-in would land them, and their records, in the wrong tenant.
  const pending = await asWorker(db, 'SELECT org_id FROM invites WHERE email = $1', [address])
  if (pending.rows[0] && pending.rows[0].org_id !== admin.orgId) return refuse('taken')
  if (!pending.rows[0]) {
    const count = await asWorker(db, 'SELECT count(*)::int AS n FROM invites WHERE org_id = $1', [
      admin.orgId,
    ])
    if ((count.rows[0]?.n ?? 0) >= MAX_PENDING_INVITES) return refuse('too-many')
  }

  await asWorker(
    db,
    `INSERT INTO invites (email, org_id, role, name) VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, name = EXCLUDED.name
     WHERE invites.org_id = EXCLUDED.org_id`,
    [address, admin.orgId, role, label]
  )

  let emailed = false
  if (typeof mail === 'function') {
    const where = origin ? ` at ${origin}` : ''
    const orgDoc = await engine.get(WORKER, 'organizations', admin.orgId)
    const org = cleanName(orgDoc?.name) || 'your organization'
    const sent = await mail({
      to: address,
      subject: `You have been invited to ${org} on WEEHS`,
      text:
        `${cleanName(admin.name) || 'An administrator'} invited you to ${org}` +
        ` on WEEHS as ${role}.\n\n` +
        `Sign in${where} with your company account (choose "Continue with company sign-in").` +
        ` Use the same email address this message was sent to.\n\n` +
        `If you were not expecting this, you can ignore it.`,
    }).catch(() => ({ sent: false }))
    emailed = sent?.sent === true
  }
  return { ok: true, email: address, role, emailed }
}

/** The caller's organization's pending invites, newest first by address. */
export async function listInvites(engine, db, { uid }) {
  const admin = await adminOf(engine, uid)
  if (!admin) return refuse('not-admin')
  const rows = await asWorker(
    db,
    'SELECT email, role, name FROM invites WHERE org_id = $1 ORDER BY email LIMIT $2',
    [admin.orgId, MAX_PENDING_INVITES]
  )
  return { ok: true, invites: rows.rows }
}

/** Withdraw a pending invite in the caller's organization. Idempotent. */
export async function revokeInvite(engine, db, { uid, email }) {
  const admin = await adminOf(engine, uid)
  if (!admin) return refuse('not-admin')
  const address = normalizeEmail(email)
  if (!address) return refuse('email')
  // org_id in the WHERE: an admin cannot withdraw another tenant's invite by
  // guessing the address.
  const res = await asWorker(db, 'DELETE FROM invites WHERE email = $1 AND org_id = $2', [
    address,
    admin.orgId,
  ])
  return { ok: true, removed: res.affectedRows > 0 }
}
