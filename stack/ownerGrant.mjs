// The provisioned owner is the registration contact, not whoever next presents
// a SAML assertion. The invite used to be the only copy of that assignment,
// and establishIdentity deleted it after inserting the profile — or returned
// an existing row unchanged and left the invite in place. A row that was not
// status "approved", or that had no orgName, then sat on the approval gate
// forever: the page reads profile.status and profile.orgName, and the
// organization name was never copied onto the founder.
//
// owner_grants is that assignment after the invite is gone. It is not a
// grant the browser can read, and it is not applied to an arbitrary NameID.
// The session uid has to be the owner email (the NameID the host signed), or
// the row has to already be the worker-written admin, or it has to be the
// single untyped user left next to that one invite. A member, a second user,
// and a profile that already belongs to another organization are left as
// they are.

const WORKER = { role: 'ohsms_worker', uid: '' }

function norm(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
}

function missingTable(err) {
  return err?.code === '42P01'
}

async function readGrant(db, email) {
  const res = await db.query(
    'SELECT email, org_id, role, org_name FROM owner_grants WHERE email = $1',
    [email]
  )
  return res.rows[0] || null
}

async function readAdminInvite(db, email) {
  const res = await db.query(
    'SELECT email, org_id, role, name FROM invites WHERE email = $1 AND role = $2',
    [email, 'admin']
  )
  return res.rows[0] || null
}

async function upsertGrant(db, { email, orgId, orgName }) {
  const current = await readGrant(db, email)
  if (current) {
    if (current.org_id !== orgId || current.role !== 'admin') return current
    if (orgName && current.org_name !== orgName) {
      await db.query('UPDATE owner_grants SET org_name = $2 WHERE email = $1 AND org_id = $3', [
        email,
        orgName,
        orgId,
      ])
      return { ...current, org_name: orgName }
    }
    return current
  }
  await db.query(
    `INSERT INTO owner_grants (email, org_id, role, org_name) VALUES ($1, $2, 'admin', $3)
     ON CONFLICT (email) DO NOTHING`,
    [email, orgId, orgName || '']
  )
  return readGrant(db, email)
}

export async function rememberOwner(db, { email, orgId, orgName }) {
  const mail = norm(email)
  if (!mail || !orgId) return null
  return upsertGrant(db, { email: mail, orgId, orgName: orgName || '' })
}

async function adminEmails(db) {
  const grants = await db.query(`SELECT email FROM owner_grants WHERE role = 'admin'`)
  const invites = await db.query(`SELECT email FROM invites WHERE role = 'admin'`)
  return [
    ...new Set([...grants.rows, ...invites.rows].map((row) => norm(row.email)).filter(Boolean)),
  ]
}

/**
 * Write the owner assignment onto this uid. Returns null when `email` is not
 * the provisioned admin. Returns the existing profile unchanged when that
 * row already belongs to a different organization.
 */
export async function bindProvisionedOwner(engine, db, { uid, email, name }) {
  const id = String(uid || '').trim()
  const mail = norm(email)
  if (!id || !mail) return null
  let grant = await readGrant(db, mail)
  let invitedName = ''
  if (!grant) {
    const invite = await readAdminInvite(db, mail)
    if (!invite) return null
    const org = await engine.get(WORKER, 'organizations', invite.org_id)
    if (!org) return null
    invitedName = invite.name || ''
    grant = await upsertGrant(db, { email: mail, orgId: invite.org_id, orgName: org.name || '' })
  }
  if (!grant || grant.role !== 'admin') return null
  const existing = await engine.get(WORKER, 'users', id)
  if (existing?.orgId && existing.orgId !== grant.org_id) {
    return { ok: true, uid: id, profile: existing }
  }
  const org = await engine.get(WORKER, 'organizations', grant.org_id)
  if (!org) return { ok: false, reason: 'no-invite' }
  const orgName = org.name || grant.org_name || ''
  const next = {
    orgId: grant.org_id,
    role: 'admin',
    status: 'approved',
    email: mail,
    orgName,
    mustChangePassword: false,
  }
  const label = name || invitedName
  if (label && !existing?.name) next.name = label
  const already =
    existing &&
    existing.orgId === next.orgId &&
    existing.role === 'admin' &&
    existing.status === 'approved' &&
    existing.email === mail &&
    existing.orgName === orgName &&
    existing.mustChangePassword !== true
  if (!already) {
    await engine.commit(WORKER, [
      {
        type: existing ? 'update' : 'set',
        path: 'users',
        id,
        merge: Boolean(existing),
        data: next,
      },
    ])
  }
  await db.query('DELETE FROM invites WHERE email = $1', [mail])
  if (orgName && grant.org_name !== orgName) {
    await db.query('UPDATE owner_grants SET org_name = $2 WHERE email = $1 AND org_id = $3', [
      mail,
      orgName,
      grant.org_id,
    ])
  }
  const profile = await engine.get(WORKER, 'users', id)
  return { ok: true, uid: id, profile }
}

async function backfillAdminGrants(engine, db) {
  const grants = await db.query(`SELECT org_id FROM owner_grants WHERE role = 'admin'`)
  const covered = new Set(grants.rows.map((row) => row.org_id))
  const orgs = await engine.list(WORKER, 'organizations', {})
  const users = await engine.list(WORKER, 'users', {})
  for (const org of orgs) {
    if (covered.has(org.id)) continue
    const admins = users.filter((user) => {
      if (user.role !== 'admin') return false
      const mail = norm(user.email)
      if (!mail.includes('@')) return false
      if (user.orgId && user.orgId !== org.id) return false
      if (!user.orgId && orgs.length !== 1) return false
      return true
    })
    const emails = [...new Set(admins.map((user) => norm(user.email)))]
    if (emails.length !== 1) continue
    await upsertGrant(db, { email: emails[0], orgId: org.id, orgName: org.name || '' })
    covered.add(org.id)
  }
}

export async function repairSignedInOwner(engine, db, uid) {
  try {
    const id = String(uid || '').trim()
    if (!id) return null
    if (id.includes('@')) {
      const bound = await bindProvisionedOwner(engine, db, { uid: id, email: id.toLowerCase() })
      if (bound) return bound
    }
    const users = await engine.list(WORKER, 'users', {})
    if (users.length !== 1 || users[0].id !== id) return null
    const only = users[0]
    if (only.role === 'member' || only.role === 'manager' || only.role === 'auditor') return null
    const onlyMail = norm(only.email)
    const emails = await adminEmails(db)
    if (emails.length !== 1) return null
    if (onlyMail && onlyMail !== emails[0]) return null
    return bindProvisionedOwner(engine, db, {
      uid: id,
      email: emails[0],
      name: only.name || '',
    })
  } catch (err) {
    if (missingTable(err)) return null
    throw err
  }
}

export async function reconcileOwnerGrants(engine, db) {
  const invites = await db.query(`SELECT email, org_id, role FROM invites WHERE role = 'admin'`)
  for (const row of invites.rows) {
    const org = await engine.get(WORKER, 'organizations', row.org_id)
    if (!org) continue
    await upsertGrant(db, { email: norm(row.email), orgId: row.org_id, orgName: org.name || '' })
  }
  await backfillAdminGrants(engine, db)
  const grants = await db.query(`SELECT email, org_id FROM owner_grants WHERE role = 'admin'`)
  const users = await engine.list(WORKER, 'users', {})
  for (const grant of grants.rows) {
    const matches = users.filter((user) => {
      if (user.orgId && user.orgId !== grant.org_id) return false
      if (user.id === grant.email) return true
      return user.role === 'admin' && norm(user.email) === grant.email
    })
    for (const user of matches) {
      await bindProvisionedOwner(engine, db, {
        uid: user.id,
        email: grant.email,
        name: user.name || '',
      })
    }
  }
  const again = await engine.list(WORKER, 'users', {})
  for (const user of again) {
    await repairSignedInOwner(engine, db, user.id)
  }
}

export async function accessFacts(engine, db, uid) {
  if (!uid) return { signedIn: false }
  await repairSignedInOwner(engine, db, uid)
  const profile = await engine.get(WORKER, 'users', uid)
  const mail = String(uid).includes('@') ? norm(uid) : ''
  const grant = mail ? await readGrant(db, mail) : null
  let ownerMatched = Boolean(
    grant &&
    grant.role === 'admin' &&
    profile?.status === 'approved' &&
    profile?.role === 'admin' &&
    profile?.orgId === grant.org_id
  )
  if (
    !ownerMatched &&
    profile?.status === 'approved' &&
    profile?.role === 'admin' &&
    profile?.orgId
  ) {
    const rows = await db.query(
      `SELECT email FROM owner_grants WHERE org_id = $1 AND role = 'admin'`,
      [profile.orgId]
    )
    const users = await engine.list(WORKER, 'users', {})
    const admins = users.filter(
      (user) => user.role === 'admin' && user.status === 'approved' && user.orgId === profile.orgId
    )
    ownerMatched = rows.rows.length === 1 && admins.length === 1 && admins[0].id === uid
  }
  return {
    signedIn: true,
    approved: profile?.status === 'approved',
    admin: profile?.role === 'admin',
    orgLinked: Boolean(profile?.orgId),
    orgNamed: Boolean(String(profile?.orgName || '').trim()),
    ownerMatched,
  }
}
