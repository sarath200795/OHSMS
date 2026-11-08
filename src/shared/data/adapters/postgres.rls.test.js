import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { applySchema, createEngine } from '../../../../stack/engine.mjs'
import { createPostgresAdapter } from './postgres'

// Embedded by default. With OHSMS_TEST_PG_URL (an ordinary login role, the
// shape a managed Postgres gives you) and OHSMS_TEST_PG_ADMIN_URL (a role
// that bypasses RLS, for seeding and for reading back what really happened),
// the same assertions run on a real Postgres. Embedded runs as superuser, and
// that hid a bug: the SECURITY DEFINER helpers recursed on every member read
// once their owner was an ordinary role (stack/schema.sql). docs/CONTROL-PLANE.md.
const PG_URL = process.env.OHSMS_TEST_PG_URL
const PG_ADMIN_URL = process.env.OHSMS_TEST_PG_ADMIN_URL
const onPg = Boolean(PG_URL && PG_ADMIN_URL)
const { createPgDatabase } = onPg ? await import('../../../../stack/pg.mjs') : {}

/** The app's own connection: what the gateway uses. */
const db = onPg ? createPgDatabase(PG_URL) : new PGlite()
const engine = createEngine(db)
/** Seeding and read-back, past RLS. On embedded, the same superuser handle. */
const admin = onPg ? createPgDatabase(PG_ADMIN_URL) : db
const adminEngine = onPg ? createEngine(admin) : engine

const browser = (uid) => ({ role: 'ohsms_browser', uid })
const as = (uid) => createPostgresAdapter(engine, browser(uid))

async function seed(path, id, data) {
  await adminEngine.commit(null, [{ type: 'set', path, id, data, merge: false }])
}

afterAll(async () => {
  if (onPg) await Promise.all([db.end(), admin.end()])
})

beforeAll(async () => {
  await applySchema(db)
  if (onPg) await admin.exec('TRUNCATE documents, files, policy_union, auth_secrets, invites')
  await seed('users', 'adminA', { orgId: 'orgA', role: 'admin', status: 'approved', name: 'Ada' })
  await seed('users', 'memberA', { orgId: 'orgA', role: 'member', status: 'approved', name: 'Mo' })
  await seed('users', 'auditorA', {
    orgId: 'orgA',
    role: 'auditor',
    status: 'approved',
    name: 'Aud',
  })
  await seed('users', 'adminB', { orgId: 'orgB', role: 'admin', status: 'approved', name: 'Bea' })
  await seed('users', 'flaggedA', {
    orgId: 'orgA',
    role: 'manager',
    status: 'approved',
    mustChangePassword: true,
    name: 'Temp',
  })
  await seed('organizations/orgA/incidents', 'i1', { title: 'Cut', orgId: 'orgA' })
  await seed('organizations/orgB/incidents', 'i2', { title: 'Fall', orgId: 'orgB' })
  await seed('organizations/orgA/injuries', 'inj1', { status: 'open', orgId: 'orgA', name: 'Mo' })
  await seed('qr', 'tok1', { orgId: 'orgA', extId: 'ext1', token: 'tok1' })
  await seed('permitQr', 'ptok', { orgId: 'orgA', permitId: 'p1', token: 'ptok' })
  await admin.query(`INSERT INTO files (path, org_id) VALUES ('orgs/orgA/photos/a.jpg', 'orgA')`)
  await admin.query(`INSERT INTO policy_union (id, org_id) VALUES ('row1', 'orgA')`)
})

describe('org isolation', () => {
  it('does not let org A read org B', async () => {
    const a = as('adminA')
    expect(await a.get('organizations/orgB/incidents', 'i2')).toBeNull()
    expect(await a.list('organizations/orgB/incidents')).toEqual([])
    await expect(
      a.set('organizations/orgB/incidents', 'sneak', { title: 'no', orgId: 'orgB' })
    ).rejects.toMatchObject({
      code: 'permission-denied',
    })
    expect(await adminEngine.get(null, 'organizations/orgB/incidents', 'sneak')).toBeNull()
  })
})

describe('roles', () => {
  it('refuses a member the manager decision on an injury', async () => {
    const member = as('memberA')
    // The row is invisible, not an empty module the caller could mistake for "no injuries".
    expect(await member.get('organizations/orgA/injuries', 'inj1')).toBeNull()
    // The row is hidden, so the update does not see it. Writing a verified
    // injury under a new id is the way a member would skip the queue, and
    // that insert is the one the trigger has to refuse.
    await expect(
      member.set('organizations/orgA/injuries', 'inj-new', { status: 'verified', orgId: 'orgA' })
    ).rejects.toMatchObject({ code: 'permission-denied' })
    expect((await adminEngine.get(null, 'organizations/orgA/injuries', 'inj1')).status).toBe('open')

    const admin = as('adminA')
    expect(await admin.get('organizations/orgA/injuries', 'inj1')).toMatchObject({ status: 'open' })
    await admin.update('organizations/orgA/injuries', 'inj1', { status: 'verified' })
    expect((await adminEngine.get(null, 'organizations/orgA/injuries', 'inj1')).status).toBe(
      'verified'
    )
  })

  it('does not let an auditor delete a document or a file', async () => {
    const auditor = as('auditorA')
    await expect(auditor.remove('organizations/orgA/incidents', 'i1')).rejects.toMatchObject({
      code: 'permission-denied',
    })
    expect(await adminEngine.get(null, 'organizations/orgA/incidents', 'i1')).toMatchObject({
      title: 'Cut',
    })

    const fileDelete = await db.transaction(async (tx) => {
      await tx.exec('SET LOCAL ROLE ohsms_browser')
      await tx.query(`SELECT set_config('app.uid', 'auditorA', true)`)
      return tx.query(`DELETE FROM files WHERE path = 'orgs/orgA/photos/a.jpg'`)
    })
    expect(fileDelete.affectedRows).toBe(0)
    const still = await admin.query(`SELECT path FROM files WHERE path = 'orgs/orgA/photos/a.jpg'`)
    expect(still.rows).toHaveLength(1)
  })

  it('lets a manager delete a file in their own org and not another', async () => {
    await admin.query(
      `INSERT INTO files (path, org_id) VALUES ('orgs/orgA/photos/b.jpg', 'orgA'), ('orgs/orgB/photos/c.jpg', 'orgB') ON CONFLICT DO NOTHING`
    )
    await db.transaction(async (tx) => {
      await tx.exec('SET LOCAL ROLE ohsms_browser')
      await tx.query(`SELECT set_config('app.uid', 'adminA', true)`)
      const gone = await tx.query(`DELETE FROM files WHERE path = 'orgs/orgA/photos/b.jpg'`)
      expect(gone.affectedRows).toBe(1)
      const foreign = await tx.query(`DELETE FROM files WHERE path = 'orgs/orgB/photos/c.jpg'`)
      // Not visible under the delete policy, so the statement removes nothing.
      expect(foreign.affectedRows).toBe(0)
    })
    const left = await admin.query(`SELECT path FROM files WHERE path = 'orgs/orgB/photos/c.jpg'`)
    expect(left.rows).toHaveLength(1)
  })
})

describe('anonymous token-bound writes', () => {
  const anon = as('')

  it('refuses a report that does not carry a live token for that asset', async () => {
    await expect(
      anon.create('organizations/orgA/reports', {
        source: 'qr',
        approvalStatus: 'pending',
        reportedBy: 'public',
        kind: 'defect',
        extId: 'ext1',
        token: 'missing',
      })
    ).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('accepts a report whose token names that asset and that org', async () => {
    const id = await anon.create('organizations/orgA/reports', {
      source: 'qr',
      approvalStatus: 'pending',
      reportedBy: 'public',
      kind: 'defect',
      extId: 'ext1',
      token: 'tok1',
    })
    expect(await adminEngine.get(null, 'organizations/orgA/reports', id)).toMatchObject({
      extId: 'ext1',
    })
  })

  it('refuses the same token against a different asset', async () => {
    await expect(
      anon.create('organizations/orgA/reports', {
        source: 'qr',
        approvalStatus: 'pending',
        reportedBy: 'public',
        kind: 'defect',
        extId: 'ext-other',
        token: 'tok1',
      })
    ).rejects.toMatchObject({ code: 'permission-denied' })
  })
})

describe('post-state check', () => {
  it('does not let a member grant themselves admin by writing the new role', async () => {
    const member = as('memberA')
    await expect(
      member.update('users', 'memberA', {
        role: 'admin',
        status: 'approved',
        orgId: 'orgA',
        name: 'Mo',
      })
    ).rejects.toMatchObject({ code: 'permission-denied' })
    expect((await adminEngine.get(null, 'users', 'memberA')).role).toBe('member')
  })

  it('does not let the password gate be cleared by the person holding it', async () => {
    const flagged = as('flaggedA')
    await expect(
      flagged.set('organizations/orgA/incidents', 'x', { title: 'no' })
    ).rejects.toMatchObject({
      code: 'permission-denied',
    })
    await expect(
      flagged.update('users', 'flaggedA', {
        orgId: 'orgA',
        role: 'manager',
        status: 'approved',
        mustChangePassword: false,
        name: 'Temp',
      })
    ).rejects.toMatchObject({ code: 'permission-denied' })
    expect((await adminEngine.get(null, 'users', 'flaggedA')).mustChangePassword).toBe(true)
  })
})

describe('permissive union', () => {
  it('lets the narrow policy win when the broad one also matches', async () => {
    async function deleted() {
      return db.transaction(async (tx) => {
        await tx.exec('SET LOCAL ROLE ohsms_browser')
        await tx.query(`SELECT set_config('app.uid', 'auditorA', true)`)
        const res = await tx.query(`DELETE FROM policy_union WHERE id = 'row1'`)
        return res.affectedRows
      })
    }
    // Both policies match an approved auditor. The restrictive one wins, so
    // the broad grant removes nothing.
    expect(await deleted()).toBe(0)
    expect(await admin.query(`SELECT id FROM policy_union WHERE id = 'row1'`)).toMatchObject({
      rows: [{ id: 'row1' }],
    })

    await db.exec('DROP POLICY union_auditor_cannot_delete ON policy_union')
    expect(await deleted()).toBe(1)

    await db.exec(`CREATE POLICY union_auditor_cannot_delete ON policy_union AS RESTRICTIVE FOR DELETE TO ohsms_browser
      USING (COALESCE(app_profile()->>'role', '') <> 'auditor')`)
    await admin.query(`INSERT INTO policy_union (id, org_id) VALUES ('row1', 'orgA')`)
    expect(await deleted()).toBe(0)
  })
})
