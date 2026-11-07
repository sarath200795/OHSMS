import { createServer } from 'node:http'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it, vi } from 'vitest'
import { applySchema, createEngine } from '../../../stack/engine.mjs'
import { fulfillRequest } from '../../../stack/fulfill.mjs'
import { establishIdentity } from '../../../stack/identity.mjs'
import { signSession, verifySession } from '../../../stack/session.mjs'
import { decidePresign } from '../../../stack/presign.mjs'
import { createPostgresAdapter } from './adapters/postgres'
import { createOwnStackServer } from '../../../stack/server.mjs'
import { identityFromSupabase } from '../../../stack/supabaseAuth.mjs'
import { samlClient, identityFromSaml } from '../../../stack/saml.mjs'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  completePasswordChange,
  runRetention,
  setLocalPassword,
  stampIdentity,
} from '../../../stack/workers.mjs'

const request = {
  id: 'reqNorthwind1',
  status: 'requested',
  orgName: 'Northwind Metals',
  address: 'Pune',
  contactName: 'Asha Rao',
  contactEmail: 'asha@northwind.test',
  handoffContact: 'ops@northwind.test',
  mode: 'weehs-operated',
  engine: 'postgres',
  authMethod: 'oidc',
  authIssuer: 'https://login.northwind.test/realms/staff',
  authClientId: 'ohsms-northwind',
  bucketMode: 'provision',
  presignUrl: '',
}

describe('own-stack fulfillment', () => {
  it('provisions a dedicated database and does not put secrets on the request', async () => {
    const db = new PGlite()
    const engine = createEngine(db)
    const written = []
    const sent = []
    const databaseUrl = 'postgres://browser.example/northwind'
    const master = 'master-secret-value-not-for-the-request'
    const result = await fulfillRequest({
      request,
      secrets: { databaseUrl, dataKeyMaster: master, oidcClientSecret: 'client-secret-value' },
      engine,
      db,
      admin: {
        update: async (id, patch) => {
          written.push({ id, patch })
        },
      },
      mail: async (message) => {
        sent.push(message)
        return { sent: true }
      },
      dedicatedUrl: 'https://northwind.example',
      gatewayUrl: 'https://northwind.example',
    })
    expect(result.ok).toBe(true)
    expect(result.publicEnv.VITE_DATA_DRIVER).toBe('postgres')
    expect(result.publicEnv.VITE_AUTH_METHOD).toBe('oidc')
    expect(result.publicEnv.VITE_AUTH_TOTP).toBe('off')
    const published = JSON.stringify(result.publicEnv) + JSON.stringify(written)
    expect(published).not.toContain(databaseUrl)
    expect(published).not.toContain(master)
    expect(published).not.toContain('client-secret-value')
    expect(written[0].patch).toEqual({
      status: 'live',
      dedicatedUrl: 'https://northwind.example',
      secretsReceived: true,
    })
    expect(sent[0].to).toBe('asha@northwind.test')
    expect(sent[0].text).toContain('https://northwind.example')

    const session = await establishIdentity(engine, db, {
      sub: 'asha-subject',
      email: 'asha@northwind.test',
      name: 'Asha Rao',
    })
    expect(session.ok).toBe(true)
    const token = signSession(result.sessionSecret, { sub: session.uid })
    expect(verifySession(result.sessionSecret, token)).toMatchObject({ sub: 'asha-subject' })
    expect(verifySession(result.sessionSecret, token)).not.toHaveProperty('role')

    const founder = createPostgresAdapter(engine, { role: 'ohsms_browser', uid: 'asha-subject' })
    const org = await founder.get('organizations', result.orgId)
    expect(org.name).toBe('Northwind Metals')
    await founder.set(`organizations/${result.orgId}/incidents`, 'i1', {
      title: 'Cut',
      orgId: result.orgId,
    })

    const stranger = createPostgresAdapter(engine, { role: 'ohsms_browser', uid: 'someone-else' })
    expect(await stranger.get(`organizations/${result.orgId}/incidents`, 'i1')).toBeNull()

    const profile = await engine.get({ role: 'ohsms_worker', uid: '' }, 'users', 'asha-subject')
    expect(
      decidePresign({ op: 'delete', path: `orgs/${result.orgId}/photos/a.jpg`, profile }).ok
    ).toBe(true)
    expect(
      decidePresign({
        op: 'delete',
        path: `orgs/${result.orgId}/photos/a.jpg`,
        profile: { ...profile, role: 'auditor' },
      }).ok
    ).toBe(false)
    expect(await stampIdentity(engine, 'asha-subject')).toMatchObject({
      stamped: true,
      role: 'admin',
    })
    const retention = await runRetention(engine, { orgId: result.orgId })
    expect(retention.livePurged).toBe(0)
  })

  it('refuses an engine that has no adapter instead of marking it live', async () => {
    const db = new PGlite()
    await applySchema(db)
    const engine = createEngine(db)
    const written = []
    const result = await fulfillRequest({
      request: { ...request, id: 'reqOther1', engine: 'mysql', mode: 'bring' },
      secrets: { databaseUrl: 'mysql://db.example/app' },
      engine,
      db,
      admin: { update: async (id, patch) => written.push(patch) },
      dedicatedUrl: 'https://example.test',
      gatewayUrl: 'https://example.test',
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('engine')
    expect(written[0].status).toBe('failed')
    expect(JSON.stringify(written)).not.toContain('mysql://')
  })
})

describe('password gate on the worker path', () => {
  it('clears mustChangePassword only after the current password matches', async () => {
    const db = new PGlite()
    const engine = createEngine(db)
    await applySchema(db)
    await engine.commit({ role: 'ohsms_worker', uid: '' }, [
      {
        type: 'set',
        path: 'users',
        id: 'u1',
        merge: false,
        data: {
          orgId: 'o',
          role: 'member',
          status: 'approved',
          email: 'a@b.test',
          mustChangePassword: true,
          name: 'A',
        },
      },
    ])
    await setLocalPassword(db, { uid: 'u1', email: 'a@b.test', password: 'temporary-pass' })
    const wrong = await completePasswordChange(engine, db, {
      uid: 'u1',
      current: 'nope-nope-nope',
      password: 'a-new-password',
      idp: false,
    })
    expect(wrong.ok).toBe(false)
    expect((await engine.get(null, 'users', 'u1')).mustChangePassword).toBe(true)
    const right = await completePasswordChange(engine, db, {
      uid: 'u1',
      current: 'temporary-pass',
      password: 'a-new-password',
      idp: false,
    })
    expect(right).toMatchObject({ ok: true, reason: 'replaced' })
    expect((await engine.get(null, 'users', 'u1')).mustChangePassword).toBe(false)
  })
})

describe('dedicated host', () => {
  it('serves a signed-in read over HTTP and refuses a forged role claim', async () => {
    const db = new PGlite()
    const engine = createEngine(db)
    const requests = new Map()
    const secret = 'session-secret-for-the-test'
    const server = createOwnStackServer({
      engine,
      db,
      sessionSecret: secret,
      origin: 'http://127.0.0.1',
      auth: { method: 'oidc', issuer: '', clientId: 'ohsms' },
      requests,
      controlToken: 'operator-token',
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    const origin = `http://127.0.0.1:${port}`
    requests.set('reqHost1', { ...request, id: 'reqHost1', authIssuer: `${origin}/oidc` })
    const started = await fetch(`${origin}/intake/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer operator-token',
      },
      body: JSON.stringify({ requestId: 'reqHost1' }),
    })
    const { token } = await started.json()
    const intake = await fetch(`${origin}/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: 'reqHost1',
        email: 'ops@northwind.test',
        token,
        secrets: { databaseUrl: 'postgres://db.example/northwind', dataKeyMaster: 'master-value' },
      }),
    })
    expect(intake.status).toBe(200)
    const echoed = await intake.json()
    expect(echoed.ok).toBe(true)
    expect(JSON.stringify(echoed)).not.toContain('master-value')
    expect(JSON.stringify(echoed)).not.toContain('postgres://')
    expect(requests.get('reqHost1').status).toBe('live')
    expect(JSON.stringify(requests.get('reqHost1'))).not.toContain('master-value')

    const again = await fetch(`${origin}/fulfill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer operator-token' },
      body: JSON.stringify({ requestId: 'reqHost1' }),
    })
    expect(again.status).toBe(400)
    expect((await again.json()).reason).toBe('already-live')
    const body = echoed

    const who = await establishIdentity(engine, db, {
      sub: 'asha-subject',
      email: 'asha@northwind.test',
      name: 'Asha Rao',
    })
    const sessionToken = signSession(secret, { sub: who.uid })
    const forged = sessionToken.split('.').slice(0, 2).join('.') + '.not-a-signature'
    const denied = await fetch(`${origin}/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${forged}` },
      body: JSON.stringify({ op: 'get', path: 'organizations', id: body.orgId }),
    })
    expect(denied.status).toBe(200)
    expect((await denied.json()).doc).toBeNull()
    const allowed = await fetch(`${origin}/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ op: 'get', path: 'organizations', id: body.orgId }),
    })
    expect(allowed.status).toBe(200)
    expect((await allowed.json()).doc.name).toBe('Northwind Metals')

    server.close()
  })
})

describe('other IdPs', () => {
  it('takes a Supabase user from GoTrue and never sends a service-role key', async () => {
    const calls = []
    const fetchImpl = async (url, opts) => {
      calls.push({ url: String(url), opts })
      if (String(url).includes('/token')) {
        return { ok: true, json: async () => ({ access_token: 'access' }) }
      }
      return { ok: true, json: async () => ({ id: 'sb-user', email: 'a@b.test' }) }
    }
    const identity = await identityFromSupabase({
      issuer: 'https://project.supabase.co/auth/v1',
      anonKey: 'anon-public',
      email: 'a@b.test',
      password: 'secret-pass',
      fetchImpl,
    })
    expect(identity).toMatchObject({ ok: true, sub: 'sb-user' })
    const blob = JSON.stringify(calls)
    expect(blob).toContain('anon-public')
    expect(blob).not.toContain('service_role')
  })

  it('rejects an unsigned SAML response', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'saml-'))
    const key = join(dir, 'key.pem')
    const cert = join(dir, 'cert.pem')
    execFileSync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-nodes',
      '-subj',
      '/CN=test-idp',
    ])
    const client = samlClient({
      issuer: 'ohsms',
      callbackUrl: 'https://app.example/auth/saml',
      idpCert: readFileSync(cert, 'utf8'),
      entryPoint: 'https://idp.example/sso',
    })
    const result = await identityFromSaml(
      client,
      Buffer.from('<Response></Response>').toString('base64')
    )
    expect(result.ok).toBe(false)
  })
})

describe('company OIDC on the dedicated host', () => {
  // The callback used to accept any pending `state`, from any browser. These
  // drive the host's own demo issuer through the real redirects, then try to
  // finish one browser's sign-in from another.
  async function oidcHost() {
    const probe = createServer()
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
    const { port } = probe.address()
    await new Promise((resolve) => probe.close(resolve))
    const origin = `http://127.0.0.1:${port}`

    const db = new PGlite()
    const engine = createEngine(db)
    const requests = new Map()
    const secret = 'session-secret-for-the-oidc-test'
    const server = createOwnStackServer({
      engine,
      db,
      sessionSecret: secret,
      origin,
      auth: { method: 'oidc', issuer: '', clientId: 'ohsms' },
      requests,
      controlToken: 'operator-token',
    })
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
    requests.set('reqOidc1', { ...request, id: 'reqOidc1', authIssuer: `${origin}/oidc` })
    const started = await fetch(`${origin}/intake/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer operator-token' },
      body: JSON.stringify({ requestId: 'reqOidc1' }),
    })
    const { token } = await started.json()
    const intake = await fetch(`${origin}/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: 'reqOidc1',
        email: 'ops@northwind.test',
        token,
        secrets: { databaseUrl: 'postgres://db.example/northwind', dataKeyMaster: 'master-value' },
      }),
    })
    expect(intake.status).toBe(200)
    return { server, origin, secret }
  }

  /** One browser: /auth/start, then the issuer's sign-in, up to the callback URL. */
  async function begin(origin, email = 'asha@northwind.test') {
    const start = await fetch(`${origin}/auth/start`, { redirect: 'manual' })
    expect(start.status).toBe(302)
    const cookie = String(start.headers.get('set-cookie') || '').split(';')[0]
    expect(cookie).toMatch(/^ohsms_oidc=.+/)
    expect(start.headers.get('set-cookie')).toMatch(/HttpOnly/)
    const authorize = await fetch(start.headers.get('location'), {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email }).toString(),
    })
    expect(authorize.status).toBe(302)
    return { cookie, callback: authorize.headers.get('location') }
  }

  const finish = (callback, cookie = '') =>
    fetch(callback, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} })

  it('signs in the browser that started the sign-in, and clears its cookie', async () => {
    const { server, origin, secret } = await oidcHost()
    const { cookie, callback } = await begin(origin)
    const res = await finish(callback, cookie)
    expect(res.status).toBe(302)
    const session = decodeURIComponent(res.headers.get('location').split('#session=')[1])
    expect(verifySession(secret, session).sub).toBe('asha@northwind.test')
    expect(res.headers.get('set-cookie')).toMatch(/^ohsms_oidc=;.*Max-Age=0/)
    server.close()
  })

  it("refuses to finish one browser's sign-in in another browser", async () => {
    const { server, origin } = await oidcHost()
    const attacker = await begin(origin)
    const victim = await begin(origin)
    const res = await finish(attacker.callback, victim.cookie)
    expect(res.status).toBe(400)
    expect(String(res.headers.get('location'))).not.toContain('#session=')
    server.close()
  })

  it('refuses a callback from a browser holding no sign-in cookie', async () => {
    const { server, origin } = await oidcHost()
    const { callback } = await begin(origin)
    expect((await finish(callback)).status).toBe(400)
    server.close()
  })

  it('refuses a sign-in left pending past ten minutes', async () => {
    const { server, origin } = await oidcHost()
    const { cookie, callback } = await begin(origin)
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60 * 1000)
    try {
      expect((await finish(callback, cookie)).status).toBe(400)
    } finally {
      clock.mockRestore()
      server.close()
    }
  })
})

describe('http server helper import', () => {
  it('does not listen during import', () => {
    expect(typeof createServer).toBe('function')
  })
})
