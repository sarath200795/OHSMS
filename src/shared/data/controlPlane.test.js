// The dedicated environment as deployed (stack/app.mjs), on PGlite.
//
// The demo host kept everything in memory, so the first redeploy forgot the
// request, the one-time token and the secrets a company had just submitted,
// and the company could no longer sign in. These restart it and check what
// came back, read the table to check what is NOT in it, and try the doors a
// deployment must keep shut: the demo OIDC issuer, a wrong state key, and a
// path out of the static directory.
import { PGlite } from '@electric-sql/pglite'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createDedicatedApp } from '../../../stack/app.mjs'
import { makeIdpKeys, readAuthnRequest, signedResponse } from '../../../e2e/support/samlIdp.mjs'

const OPERATOR = 'operator-token-for-the-test-0123456789'
const request = {
  id: 'reqDedicated01',
  status: 'requested',
  orgName: 'Northwind Metals',
  address: 'Pune',
  contactName: 'Asha Rao',
  contactEmail: 'asha@northwind.test',
  handoffContact: 'asha@northwind.test',
  mode: 'bring',
  engine: 'postgres',
  authMethod: 'saml',
  authIssuer: 'https://idp.northwind.test/saml',
  authClientId: 'ohsms-northwind',
  bucketMode: 'provision',
  presignUrl: '',
}
const DB_URL = 'postgres://ehs_browser@db.northwind.internal:5432/ehs'
const MASTER = 'nw-dkm-' + 'a'.repeat(40)

function staticDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dedicated-app-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>app</title>')
  writeFileSync(join(dir, 'assets', 'main-abc.js'), 'console.log(1)')
  return dir
}

async function start(db, { stateKey, dir = '' } = {}) {
  const app = await createDedicatedApp({
    db,
    stateKey,
    origin: 'http://127.0.0.1',
    sessionSecret: 's'.repeat(40),
    controlToken: OPERATOR,
    dataKeyMaster: 'm'.repeat(40),
    mail: null,
    staticDir: dir,
  })
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${app.server.address().port}`
  const stop = () => new Promise((resolve) => app.server.close(resolve))
  return { ...app, origin, stop }
}

async function fileAndHandOff(origin, secrets) {
  const filed = await fetch(`${origin}/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPERATOR}` },
    body: JSON.stringify(request),
  })
  expect(filed.status).toBe(200)
  // No mail configured: the token comes back to the operator, once.
  const { token } = await filed.json()
  const intake = await fetch(`${origin}/intake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: request.id, email: request.contactEmail, token, secrets }),
  })
  return { token, intake }
}

describe('dedicated environment across a restart', () => {
  it('keeps the request, the consumed token and the adopted SAML sign-in', async () => {
    const db = new PGlite()
    const stateKey = randomBytes(32)
    const keys = makeIdpKeys('northwind-idp')
    const first = await start(db, { stateKey })
    const { token, intake } = await fileAndHandOff(first.origin, {
      databaseUrl: DB_URL,
      dataKeyMaster: MASTER,
      samlIdpCert: keys.cert,
      samlEntryPoint: 'https://idp.northwind.test/sso',
    })
    expect(intake.status).toBe(200)
    await first.stop()

    // A new process on the same database.
    const second = await start(db, { stateKey })
    expect(second.state.requests.get(request.id).status).toBe('live')
    const signIn = await fetch(`${second.origin}/auth/start`, { redirect: 'manual' })
    expect(signIn.status).toBe(302)
    expect(signIn.headers.get('location')).toMatch(/^https:\/\/idp\.northwind\.test\/sso\?/)

    // The token was spent before the restart and stays spent after it.
    expect(second.state.intake.get(request.id)).toMatchObject({ used: true, hash: null })
    const reuse = await fetch(`${second.origin}/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: request.id,
        email: request.contactEmail,
        token,
        secrets: { dataKeyMaster: MASTER },
      }),
    })
    expect(reuse.status).toBe(403)
    await second.stop()
  })

  it('stores no secret readable without the key', async () => {
    const db = new PGlite()
    const keys = makeIdpKeys('northwind-idp')
    const app = await start(db, { stateKey: randomBytes(32) })
    await fileAndHandOff(app.origin, {
      databaseUrl: DB_URL,
      dataKeyMaster: MASTER,
      samlIdpCert: keys.cert,
      samlEntryPoint: 'https://idp.northwind.test/sso',
    })
    await app.stop()
    const dump = JSON.stringify((await db.query('SELECT * FROM control_state')).rows)
    expect(dump).toContain('Northwind Metals') // the non-secret request is there
    for (const secret of [DB_URL, MASTER, keys.cert.split('\n')[1], 'idp.northwind.test/sso']) {
      expect(dump).not.toContain(secret)
    }
  })

  it('refuses to start with a different state key rather than forget the secrets', async () => {
    const db = new PGlite()
    const app = await start(db, { stateKey: randomBytes(32) })
    await fileAndHandOff(app.origin, { databaseUrl: DB_URL, dataKeyMaster: MASTER })
    await app.stop()
    await expect(start(db, { stateKey: randomBytes(32) })).rejects.toThrow()
  })
})

describe('doors a deployment keeps shut', () => {
  it('serves no demo OIDC issuer, and refuses sign-in before a handoff names an IdP', async () => {
    const app = await start(new PGlite(), { stateKey: randomBytes(32) })
    for (const path of [
      '/oidc/authorize',
      '/oidc/token',
      '/oidc/userinfo',
      '/.well-known/openid-configuration',
    ]) {
      const res = await fetch(`${app.origin}${path}`, {
        method: path === '/oidc/token' ? 'POST' : 'GET',
      })
      expect(res.status, path).toBe(404)
    }
    const signIn = await fetch(`${app.origin}/auth/start`, { redirect: 'manual' })
    expect(signIn.status).toBe(503)
    await app.stop()
  })

  it('refuses /requests without the operator token', async () => {
    const app = await start(new PGlite(), { stateKey: randomBytes(32) })
    const res = await fetch(`${app.origin}/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' },
      body: JSON.stringify(request),
    })
    expect(res.status).toBe(401)
    await app.stop()
  })
})

describe('serving the built app', () => {
  it('serves files, falls back to the app for client routes, and keeps the API', async () => {
    const dir = staticDir()
    const app = await start(new PGlite(), { stateKey: randomBytes(32), dir })
    const asset = await fetch(`${app.origin}/assets/main-abc.js`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('cache-control')).toContain('immutable')
    expect(asset.headers.get('x-frame-options')).toBe('DENY')
    const route = await fetch(`${app.origin}/portal/settings`)
    expect(await route.text()).toContain('<title>app</title>')
    expect(route.headers.get('cache-control')).toBe('no-cache')
    const health = await fetch(`${app.origin}/health`)
    expect(await health.json()).toEqual({ ok: true })
    await app.stop()
  })

  it('does not serve a file from outside its directory', async () => {
    const dir = staticDir()
    writeFileSync(join(dir, '..', 'outside-secret.txt'), 'do-not-serve')
    const app = await start(new PGlite(), { stateKey: randomBytes(32), dir })
    for (const path of [
      '/../outside-secret.txt',
      '/%2e%2e/outside-secret.txt',
      '/assets/%2e%2e/%2e%2e/outside-secret.txt',
      '/..%2foutside-secret.txt',
    ]) {
      const body = await (await fetch(`${app.origin}${path}`)).text()
      expect(body, path).not.toContain('do-not-serve')
    }
    await app.stop()
  })
})

// A managed Postgres (Cloud SQL, Supabase, Neon…) gives no SUPERUSER. PGlite
// does, and running as superuser hid three bugs that each broke the deployed
// environment outright: the schema could not create its roles, every member
// read recursed through the SECURITY DEFINER helpers, and fulfillment's
// invite insert was refused by FORCE ROW LEVEL SECURITY. This runs the whole
// path on a PGlite set up the way a managed database is: the roles made once
// by an administrator, and the app connected as an ordinary owner.
async function managedLikeDb() {
  const db = new PGlite()
  await db.exec(`
    CREATE ROLE ohsms_browser NOLOGIN;
    CREATE ROLE ohsms_worker NOLOGIN BYPASSRLS;
    CREATE ROLE app NOLOGIN;
    GRANT ohsms_browser, ohsms_worker TO app;
    ALTER SCHEMA public OWNER TO app;
    SET ROLE app;
  `)
  const who = await db.query(
    'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user'
  )
  expect(who.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false })
  return db
}

describe('on a database where the app is not a superuser', () => {
  it('provisions, survives a restart, signs the founder in and serves their records', async () => {
    const db = await managedLikeDb()
    const stateKey = randomBytes(32)
    const keys = makeIdpKeys('northwind-idp')
    const first = await start(db, { stateKey })
    const { intake } = await fileAndHandOff(first.origin, {
      databaseUrl: DB_URL,
      dataKeyMaster: MASTER,
      samlIdpCert: keys.cert,
      samlEntryPoint: 'https://idp.northwind.test/sso',
    })
    expect(intake.status).toBe(200)
    await first.stop()

    const app = await start(db, { stateKey })
    const begin = await fetch(`${app.origin}/auth/start`, { redirect: 'manual' })
    const cookie = String(begin.headers.get('set-cookie')).split(';')[0]
    const authn = readAuthnRequest(
      new URL(begin.headers.get('location')).searchParams.get('SAMLRequest')
    )
    const acs = await fetch(`${app.origin}/auth/saml`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: new URLSearchParams({
        SAMLResponse: signedResponse({
          keys,
          request: authn,
          idpEntityId: 'https://idp.northwind.test/saml',
          email: request.contactEmail,
          name: 'Asha Rao',
        }),
      }).toString(),
    })
    expect(acs.status).toBe(302)
    const session = decodeURIComponent(acs.headers.get('location').split('#session=')[1])

    const read = (path, id) =>
      fetch(`${app.origin}/data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
        body: JSON.stringify({ op: 'get', path, id }),
      }).then((r) => r.json())
    const me = await read('users', request.contactEmail)
    expect(me.doc).toMatchObject({ role: 'admin', status: 'approved' })
    expect((await read('organizations', me.doc.orgId)).doc).toMatchObject({
      name: 'Northwind Metals',
    })
    await app.stop()
  })
})
