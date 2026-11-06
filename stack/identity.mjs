// First sign-in on a dedicated stack. The IdP says who the person is. The
// invite, written by fulfillment as the worker, says they are the founder.
// No WEEHS Firebase user is created.

const WORKER = { role: 'ohsms_worker', uid: '' }

export async function establishIdentity(engine, db, { sub, email, name }) {
  const uid = String(sub || '').trim()
  const mail = String(email || '')
    .trim()
    .toLowerCase()
  if (!uid || !mail) return { ok: false, reason: 'identity' }
  const existing = await engine.get(WORKER, 'users', uid)
  if (existing) return { ok: true, uid, profile: existing }

  const invite = await db.query('SELECT email, org_id, role, name FROM invites WHERE email = $1', [
    mail,
  ])
  const row = invite.rows[0]
  if (!row) return { ok: false, reason: 'no-invite' }
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
  await db.query('DELETE FROM invites WHERE email = $1', [mail])
  const profile = await engine.get(WORKER, 'users', uid)
  return { ok: true, uid, profile }
}
