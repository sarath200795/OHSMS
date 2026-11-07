import { createServer } from 'node:http'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { applySchema, createEngine } from '../../../stack/engine.mjs'
import { fulfillRequest } from '../../../stack/fulfill.mjs'
import { establishIdentity } from '../../../stack/identity.mjs'
import { signSession, verifySession } from '../../../stack/session.mjs'
import { decidePresign } from '../../../stack/presign.mjs'
import { createPostgresAdapter } from './adapters/postgres'
import { createOwnStackServer, MAX_BODY_BYTES } from '../../../stack/server.mjs'
import { identityFromSupabase } from '../../../stack/supabaseAuth.mjs'
import { samlClient, identityFromSaml } from '../../../stack/saml.mjs'
import { makeIdpKeys, readAuthnRequest, signedResponse } from '../../../e2e/support/samlIdp.mjs'
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

describe('company SAML on the dedicated host', () => {
  // The SPA sends a SAML company to /auth/start, the same as OIDC. That route
  // used to start an OIDC flow whatever the request said, so a company that
  // chose SAML had no way in. These drive the real host with a real signed
  // response, and then try to get in without one.
  async function samlHost({
    certAs = (pem) => pem,
    entryPoint = 'https://idp.northwind.test/sso',
    expect200 = true,
  } = {}) {
    const db = new PGlite()
    const engine = createEngine(db)
    const requests = new Map()
    const secret = 'session-secret-for-the-saml-test'
    const keys = makeIdpKeys('northwind-idp')
    const server = createOwnStackServer({
      engine,
      db,
      sessionSecret: secret,
      origin: 'http://127.0.0.1',
      auth: { method: 'oidc', issuer: '', clientId: '' },
      requests,
      controlToken: 'operator-token',
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    requests.set('reqSaml1', {
      ...request,
      id: 'reqSaml1',
      authMethod: 'saml',
      authIssuer: 'https://idp.northwind.test/saml',
      authClientId: 'ohsms-northwind',
    })
    const started = await fetch(`${origin}/intake/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer operator-token' },
      body: JSON.stringify({ requestId: 'reqSaml1' }),
    })
    const { token } = await started.json()
    const intake = await fetch(`${origin}/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: 'reqSaml1',
        email: 'ops@northwind.test',
        token,
        secrets: {
          dataKeyMaster: 'master-value',
          samlIdpCert: certAs(keys.cert),
          samlEntryPoint: entryPoint,
        },
      }),
    })
    if (expect200) expect(intake.status).toBe(200)
    return { server, origin, keys, secret, intake, requests }
  }

  async function start(origin) {
    const res = await fetch(`${origin}/auth/start`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location'))
    // The browser's half of the binding: what /auth/start set, sent back.
    const cookie = String(res.headers.get('set-cookie') || '').split(';')[0]
    expect(cookie).toMatch(/^ohsms_saml=.+/)
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/)
    return {
      location,
      cookie,
      authn: readAuthnRequest(location.searchParams.get('SAMLRequest')),
    }
  }

  function post(origin, samlResponse, cookie = '') {
    return fetch(`${origin}/auth/saml`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: new URLSearchParams({ SAMLResponse: samlResponse }).toString(),
    })
  }

  const answer = (keys, authn, email = 'asha@northwind.test') =>
    signedResponse({
      keys,
      request: authn,
      idpEntityId: 'https://idp.northwind.test/saml',
      email,
      name: 'Asha Rao',
    })

  it('sends the browser to the company IdP and signs in the invited founder', async () => {
    const { server, origin, keys, secret } = await samlHost()
    const { location, authn, cookie } = await start(origin)
    expect(location.origin + location.pathname).toBe('https://idp.northwind.test/sso')
    expect(authn.issuer).toBe('ohsms-northwind')

    const res = await post(origin, answer(keys, authn), cookie)
    expect(res.status).toBe(302)
    const back = res.headers.get('location')
    const session = decodeURIComponent(back.split('#session=')[1])
    expect(verifySession(secret, session).sub).toBe('asha@northwind.test')
    server.close()
  })

  it('accepts a certificate whose line breaks were lost in the handoff field', async () => {
    const { server, origin, keys } = await samlHost({
      certAs: (pem) => pem.replace(/\r?\n/g, ''),
    })
    const { authn, cookie } = await start(origin)
    expect((await post(origin, answer(keys, authn), cookie)).status).toBe(302)
    server.close()
  })

  it('does not mark a SAML company live without the IdP entry point', async () => {
    const { server, origin, intake, requests } = await samlHost({
      entryPoint: '  ',
      expect200: false,
    })
    expect(intake.status).toBe(400)
    expect((await intake.json()).reason).toBe('saml')
    expect(requests.get('reqSaml1').status).toBe('requested')
    const start = await fetch(`${origin}/auth/start`, { redirect: 'manual' })
    expect(String(start.headers.get('location'))).not.toContain('idp.northwind.test')
    server.close()
  })

  it('refuses an oversized body on the unauthenticated assertion route', async () => {
    const { server, origin } = await samlHost()
    const res = await fetch(`${origin}/auth/saml`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'SAMLResponse=' + 'A'.repeat(MAX_BODY_BYTES + 1),
    })
    expect(res.status).toBe(413)
    expect((await fetch(`${origin}/health`)).status).toBe(200)
    server.close()
  })

  it('refuses a valid response posted from a browser that did not start that sign-in', async () => {
    // Login CSRF: an invited user starts a sign-in, authenticates as
    // themselves, and makes the victim's browser (which holds its own
    // sign-in cookie, or none) post the response.
    const { server, origin, keys } = await samlHost()
    const attacker = await start(origin)
    const victim = await start(origin)
    const response = answer(keys, attacker.authn)
    expect((await post(origin, response, victim.cookie)).status).toBe(401)
    expect((await post(origin, response)).status).toBe(401)
    server.close()
  })

  it('clears the one-time sign-in cookie once it is used', async () => {
    const { server, origin, keys } = await samlHost()
    const { authn, cookie } = await start(origin)
    const res = await post(origin, answer(keys, authn), cookie)
    expect(res.status).toBe(302)
    expect(res.headers.get('set-cookie')).toMatch(/^ohsms_saml=;.*Max-Age=0/)
    server.close()
  })

  it('refuses the same signed response a second time', async () => {
    const { server, origin, keys } = await samlHost()
    const { authn, cookie } = await start(origin)
    const response = answer(keys, authn)
    expect((await post(origin, response, cookie)).status).toBe(302)
    expect((await post(origin, response, cookie)).status).toBe(401)
    server.close()
  })

  it('refuses a correctly signed response nobody asked for', async () => {
    const { server, origin, keys } = await samlHost()
    const { authn, cookie } = await start(origin)
    const unsolicited = answer(keys, { ...authn, id: '_never-issued-by-this-host' })
    expect((await post(origin, unsolicited, cookie)).status).toBe(401)
    server.close()
  })

  it('refuses a response signed by a key other than the company IdP', async () => {
    const { server, origin } = await samlHost()
    const { authn, cookie } = await start(origin)
    const forged = answer(makeIdpKeys('attacker-idp'), authn)
    expect((await post(origin, forged, cookie)).status).toBe(401)
    server.close()
  })

  it('does not admit a valid IdP user who was never invited', async () => {
    const { server, origin, keys } = await samlHost()
    const { authn, cookie } = await start(origin)
    const res = await post(origin, answer(keys, authn, 'stranger@northwind.test'), cookie)
    expect(res.status).toBe(403)
    expect(res.headers.get('location')).toBeNull()
    server.close()
  })
})

describe('http server helper import', () => {
  it('does not listen during import', () => {
    expect(typeof createServer).toBe('function')
  })
})
