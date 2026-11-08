import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { applySchema, asWorker, createEngine } from '../../../stack/engine.mjs'
import { fulfillRequest } from '../../../stack/fulfill.mjs'
import { establishIdentity } from '../../../stack/identity.mjs'

const WORKER = { role: 'ohsms_worker', uid: '' }

async function invited() {
  const db = new PGlite()
  await applySchema(db)
  const engine = createEngine(db)
  await engine.commit(WORKER, [
    { type: 'set', path: 'organizations', id: 'org1', merge: false, data: { name: 'Keel Works' } },
  ])
  await asWorker(
    db,
    "INSERT INTO invites (email, org_id, role, name) VALUES ('ana@keel.test', 'org1', 'admin', 'Ana')"
  )
  return { db, engine }
}

describe('first sign-in claims the invite once', () => {
  it('lets two simultaneous sign-ins on one invite make one member, not two', async () => {
    const { db, engine } = await invited()
    const results = await Promise.all([
      establishIdentity(engine, db, { sub: 'idp|ana', email: 'Ana@Keel.test', name: 'Ana' }),
      establishIdentity(engine, db, { sub: 'idp|ana-2', email: 'ana@keel.test', name: 'Ana' }),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    const users = await asWorker(db, "SELECT id FROM documents WHERE path = 'users'")
    expect(users.rows).toHaveLength(1)
    const left = await asWorker(db, 'SELECT email FROM invites')
    expect(left.rows).toHaveLength(0)
  })

  it('refuses a second identity on an invite the first one already used', async () => {
    const { db, engine } = await invited()
    await establishIdentity(engine, db, { sub: 'idp|ana', email: 'ana@keel.test' })
    const other = await establishIdentity(engine, db, {
      sub: 'idp|mallory',
      email: 'ana@keel.test',
    })
    expect(other).toEqual({ ok: false, reason: 'no-invite' })
  })
})

describe('fulfillment refuses a sign-in it could never serve', () => {
  const base = {
    id: 'reqKeel000001',
    status: 'requested',
    orgName: 'Keel Works',
    contactEmail: 'ana@keel.test',
    engine: 'postgres',
    mode: 'weehs-operated',
  }
  const run = (request, secrets = { oidcClientSecret: 's' }) =>
    fulfillRequest({ request, secrets, engine: null, db: null, admin: null })

  it('refuses Supabase without its issuer or anon key', async () => {
    expect(
      await run({ ...base, authMethod: 'supabase', authIssuer: '' }, { supabaseAnonKey: 'k' })
    ).toEqual({ ok: false, reason: 'supabase' })
    expect(
      await run({ ...base, authMethod: 'supabase', authIssuer: 'https://x.supabase.co/auth/v1' })
    ).toEqual({ ok: false, reason: 'supabase' })
  })

  it('refuses OIDC without its issuer or client id', async () => {
    expect(await run({ ...base, authMethod: 'oidc', authIssuer: '', authClientId: 'c' })).toEqual({
      ok: false,
      reason: 'oidc',
    })
    expect(
      await run({
        ...base,
        authMethod: 'oidc',
        authIssuer: 'https://login.keel.test',
        authClientId: '',
      })
    ).toEqual({ ok: false, reason: 'oidc' })
  })
})

describe('invite addresses', () => {
  it('takes an ordinary address and refuses empty domain labels', async () => {
    const { normalizeEmail } = await import('../../../stack/invites.mjs')
    expect(normalizeEmail(' Ana@Keel.Test ')).toBe('ana@keel.test')
    expect(normalizeEmail('ana@mail.keel.co.in')).toBe('ana@mail.keel.co.in')
    for (const bad of ['a@b..test', 'a@.b.test', 'a@b.test.', 'a@b', ['a@b.test']]) {
      expect(normalizeEmail(bad)).toBe('')
    }
  })
})
