// First sign-in on a dedicated stack. The IdP says who the person is. The
// invite, written by fulfillment as the worker, says they are the founder.
// No WEEHS Firebase user is created.

import { asWorker } from './engine.mjs'

const WORKER = { role: 'ohsms_worker', uid: '' }

export async function establishIdentity(engine, db, { sub, email, name }) {
  const uid = String(sub || '').trim()
  const mail = String(email || '')
    .trim()
    .toLowerCase()
  if (!uid || !mail) return { ok: false, reason: 'identity' }
  const existing = await engine.get(WORKER, 'users', uid)
  if (existing) return { ok: true, uid, profile: existing }

  // Claim the invite and consume it in one statement. Reading it first and
  // deleting it after the user row was written let two first sign-ins for the
  // same address (two tabs, a retried callback) both see it and both become
  // members, and let a revoke that landed in between be ignored.
  const claimed = await asWorker(
    db,
    'DELETE FROM invites WHERE email = $1 RETURNING email, org_id, role, name',
    [mail]
  )
  const row = claimed.rows[0]
  if (!row) {
    // The other sign-in won the claim; it is the same person, so use its user.
    const raced = await engine.get(WORKER, 'users', uid)
    if (raced) return { ok: true, uid, profile: raced }
    return { ok: false, reason: 'no-invite' }
  }
  try {
    await engine.commit(WORKER, [
      {
        type: 'set',
        path: 'users',
        id: uid,
        merge: false,
        data: {
          orgId: row.org_id,
          role: row.role,
          status: 'approved',
          name: name || row.name || mail,
          email: mail,
          mustChangePassword: false,
        },
      },
    ])
  } catch (err) {
    // Put the invite back so the person can try again, rather than leaving
    // them with neither an invite nor an account.
    await asWorker(
      db,
      `INSERT INTO invites (email, org_id, role, name) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      [row.email, row.org_id, row.role, row.name]
    )
    throw err
  }
  const profile = await engine.get(WORKER, 'users', uid)
  return { ok: true, uid, profile }
}
