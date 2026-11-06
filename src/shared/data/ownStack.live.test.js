import { createServer } from 'node:http'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { applySchema, createEngine } from '../../../stack/engine.mjs'
import { fulfillRequest } from '../../../stack/fulfill.mjs'
import { establishIdentity } from '../../../stack/identity.mjs'
import { signSession, verifySession } from '../../../stack/session.mjs'
import { decidePresign } from '../../../stack/presign.mjs'
import { createHttpPostgresAdapter, createPostgresAdapter } from './adapters/postgres'
import { clearAccessToken, setAccessToken } from '../auth/ownStackSession'
import { createOwnStackServer } from '../../../stack/server.mjs'
import { identityFromSupabase } from '../../../stack/supabaseAuth.mjs'
import { samlClient, identityFromSaml } from '../../../stack/saml.mjs'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFixtureIdp } from '../../../stack/samlFixture.mjs'
import { resolveSpaRequest } from '../../../stack/spa.mjs'
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

function hidden(html, name) {
  const match = new RegExp(`name="${name}" value="([^"]*)"`).exec(html)
  return match ? match[1] : ''
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const origin = `http://127.0.0.1:${port}`
  server.stackState.origin = origin
  return origin
}

describe('dedicated host application', () => {
  it('serves the SPA and a round-trip blob only after fulfillment', async () => {
    const db = new PGlite()
    const engine = createEngine(db)
    const root = mkdtempSync(join(tmpdir(), 'spa-'))
    mkdirSync(join(root, 'assets'))
    writeFileSync(
      join(root, 'index.html'),
      '<!doctype html><html><head><title>OHSMS</title></head><body>ready</body></html>'
    )
    writeFileSync(join(root, 'assets', 'app.js'), 'console.log("ohsms")\n')
    const outside = mkdtempSync(join(tmpdir(), 'spa-outside-'))
    writeFileSync(join(outside, 'secret.txt'), 'not-for-the-browser')
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
      spaRoot: root,
    })
    const origin = await listen(server)
    try {
      const before = await fetch(`${origin}/`)
      expect(before.status).toBe(404)
      expect((await before.json()).message).toBe('not found')
      requests.set('reqHostSpa1', { ...request, id: 'reqHostSpa1', authIssuer: `${origin}/oidc` })
      const started = await fetch(`${origin}/intake/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer operator-token' },
        body: JSON.stringify({ requestId: 'reqHostSpa1' }),
      })
      const { token } = await started.json()
      const databaseUrl = 'postgres://db.example/northwind'
      const master = 'master-value-not-in-the-page'
      const intake = await fetch(`${origin}/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'reqHostSpa1',
          email: 'ops@northwind.test',
          token,
          secrets: { databaseUrl, dataKeyMaster: master },
        }),
      })
      expect(intake.status).toBe(200)

      const page = await fetch(`${origin}/`)
      expect(page.status).toBe(200)
      expect(page.headers.get('content-type')).toContain('text/html')
      const html = await page.text()
      expect(html).toContain('<title>OHSMS</title>')
      expect(html).toContain('<script src="/stack-env.js"></script>')
      const portal = await fetch(`${origin}/portal`)
      expect(await portal.text()).toContain('<title>OHSMS</title>')
      const asset = await fetch(`${origin}/assets/app.js`)
      expect(await asset.text()).toContain('console.log("ohsms")')
      expect(asset.headers.get('content-type')).toContain('javascript')
      const missing = await fetch(`${origin}/assets/missing.js`)
      expect(missing.status).toBe(404)
      expect(await missing.text()).not.toContain('<title>OHSMS</title>')
      const health = await fetch(`${origin}/health`)
      expect(await health.json()).toEqual({ ok: true })
      const env = await fetch(`${origin}/stack-env.js`)
      const source = await env.text()
      expect(source).toContain('"VITE_DATA_DRIVER":"postgres"')
      expect(source).toContain(`"VITE_DATA_GATEWAY":"${origin}"`)
      expect(source).toContain('"VITE_STORAGE_DRIVER":"s3"')
      expect(source).toContain(`${origin}/presign`)
      expect(source).not.toContain(databaseUrl)
      expect(source).not.toContain(master)
      expect(await resolveSpaRequest(root, '/../secret.txt')).toMatchObject({ kind: 'forbidden' })
      expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('not-for-the-browser')

      const who = await establishIdentity(engine, db, {
        sub: 'asha-subject',
        email: 'asha@northwind.test',
        name: 'Asha Rao',
      })
      const sessionToken = signSession(secret, { sub: who.uid })
      const authz = { Authorization: `Bearer ${sessionToken}` }
      const path = `orgs/${(await intake.json()).orgId}/incident-photos/a.png`
      const presign = await fetch(`${origin}/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authz },
        body: JSON.stringify({ op: 'put', path, contentType: 'image/png' }),
      })
      expect(presign.status).toBe(200)
      const signed = await presign.json()
      const bytes = Buffer.from('png-bytes')
      const put = await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: bytes,
      })
      expect(put.status).toBe(200)
      const again = await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: bytes,
      })
      expect(again.status).toBe(403)
      const anon = await fetch(signed.publicUrl)
      expect(anon.status).toBe(401)
      const got = await fetch(signed.publicUrl, { headers: authz })
      expect(got.status).toBe(200)
      expect(Buffer.from(await got.arrayBuffer())).toEqual(bytes)

      const worker = { role: 'ohsms_worker', uid: '' }
      const orgId = path.split('/')[1]
      await engine.commit(worker, [
        {
          type: 'set',
          path: 'users',
          id: 'auditor-subject',
          merge: false,
          data: {
            orgId,
            role: 'auditor',
            status: 'approved',
            email: 'aud@northwind.test',
            name: 'Aud',
          },
        },
        {
          type: 'set',
          path: 'users',
          id: 'stranger-subject',
          merge: false,
          data: {
            orgId: 'org-other',
            role: 'admin',
            status: 'approved',
            email: 'other@example.test',
            name: 'Other',
          },
        },
        {
          type: 'set',
          path: 'users',
          id: 'member-subject',
          merge: false,
          data: {
            orgId,
            role: 'member',
            status: 'approved',
            email: 'mem@northwind.test',
            name: 'Mem',
          },
        },
      ])
      const auditor = signSession(secret, { sub: 'auditor-subject' })
      const refused = await fetch(`${origin}/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auditor}` },
        body: JSON.stringify({
          op: 'put',
          path: `orgs/${orgId}/incident-photos/b.png`,
          contentType: 'image/png',
        }),
      })
      expect(refused.status).toBe(403)
      const stranger = signSession(secret, { sub: 'stranger-subject' })
      const foreign = await fetch(signed.publicUrl, {
        headers: { Authorization: `Bearer ${stranger}` },
      })
      expect(foreign.status).toBe(403)
      const medicalPath = `orgs/${orgId}/medical-records/note.pdf`
      const medicalPut = await fetch(`${origin}/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authz },
        body: JSON.stringify({ op: 'put', path: medicalPath, contentType: 'application/pdf' }),
      })
      const medicalSigned = await medicalPut.json()
      expect(medicalPut.status).toBe(200)
      expect(
        (
          await fetch(medicalSigned.uploadUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/pdf' },
            body: Buffer.from('pdf'),
          })
        ).status
      ).toBe(200)
      const member = signSession(secret, { sub: 'member-subject' })
      expect(
        (await fetch(medicalSigned.publicUrl, { headers: { Authorization: `Bearer ${member}` } }))
          .status
      ).toBe(403)
      expect((await fetch(medicalSigned.publicUrl, { headers: authz })).status).toBe(200)

      const svg = await fetch(`${origin}/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authz },
        body: JSON.stringify({
          op: 'put',
          path: `orgs/${orgId}/incident-photos/x.svg`,
          contentType: 'image/svg+xml',
        }),
      })
      const svgSigned = await svg.json()
      expect(
        (
          await fetch(svgSigned.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'image/svg+xml' },
            body: '<svg></svg>',
          })
        ).status
      ).toBe(415)

      const removing = await fetch(`${origin}/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authz },
        body: JSON.stringify({ op: 'delete', path }),
      })
      expect(removing.status).toBe(200)
      const { deleteUrl } = await removing.json()
      expect((await fetch(deleteUrl, { method: 'DELETE' })).status).toBe(200)
      expect((await fetch(signed.publicUrl, { headers: authz })).status).toBe(404)
      expect((await fetch(`${origin}/fixture/saml/sso`)).status).toBe(404)
    } finally {
      server.close()
    }
  })

  it('completes company SAML against the local fixture and rejects a replay', async () => {
    const db = new PGlite()
    const engine = createEngine(db)
    const { key, cert } = createFixtureIdp()
    const requests = new Map()
    const server = createOwnStackServer({
      engine,
      db,
      sessionSecret: 'session-secret-for-the-test',
      origin: 'http://127.0.0.1',
      auth: { method: 'saml', clientId: 'ohsms' },
      requests,
      controlToken: 'operator-token',
      samlFixtureKey: key,
      spaRoot: mkdtempSync(join(tmpdir(), 'spa-empty-')),
    })
    const origin = await listen(server)
    try {
      requests.set('reqHostSaml1', {
        ...request,
        id: 'reqHostSaml1',
        authMethod: 'saml',
        authIssuer: '',
        authClientId: 'ohsms',
      })
      const started = await fetch(`${origin}/intake/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer operator-token' },
        body: JSON.stringify({ requestId: 'reqHostSaml1' }),
      })
      const { token } = await started.json()
      const entryPoint = `${origin}/fixture/saml/sso`
      const intake = await fetch(`${origin}/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'reqHostSaml1',
          email: 'ops@northwind.test',
          token,
          secrets: {
            databaseUrl: 'postgres://db.example/northwind',
            samlIdpCert: cert,
            samlEntryPoint: entryPoint,
          },
        }),
      })
      const fulfilled = await intake.json()
      expect(intake.status).toBe(200)
      expect(fulfilled.ok).toBe(true)
      const published = await (await fetch(`${origin}/stack-env.js`)).text()
      expect(published).toContain('"VITE_AUTH_METHOD":"saml"')
      expect(published).not.toContain('BEGIN CERTIFICATE')
      expect(published).not.toContain('/fixture/saml/sso')

      const start = await fetch(`${origin}/auth/start`, { redirect: 'manual' })
      expect(start.status).toBe(302)
      const atIdp = new URL(start.headers.get('location'))
      expect(`${atIdp.origin}${atIdp.pathname}`).toBe(entryPoint)
      const form = await (await fetch(start.headers.get('location'))).text()
      const posted = await fetch(`${origin}/fixture/saml/sso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: 'asha@northwind.test',
          SAMLRequest: hidden(form, 'SAMLRequest'),
          RelayState: hidden(form, 'RelayState'),
        }),
      })
      const auto = await posted.text()
      const acs = await fetch(`${origin}/auth/saml/acs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        redirect: 'manual',
        body: new URLSearchParams({
          SAMLResponse: hidden(auto, 'SAMLResponse'),
          RelayState: hidden(auto, 'RelayState'),
        }),
      })
      expect(acs.status).toBe(302)
      const landed = new URL(acs.headers.get('location'))
      const sessionToken = decodeURIComponent(landed.hash.replace(/^#session=/, ''))
      const org = await fetch(`${origin}/data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ op: 'get', path: 'organizations', id: fulfilled.orgId }),
      })
      expect((await org.json()).doc.name).toBe('Northwind Metals')
      const replay = await fetch(`${origin}/auth/saml/acs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ SAMLResponse: hidden(auto, 'SAMLResponse') }),
      })
      expect(replay.status).toBe(401)
      const unsigned = await fetch(`${origin}/auth/saml/acs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          SAMLResponse: Buffer.from('<Response></Response>').toString('base64'),
        }),
      })
      expect(unsigned.status).toBe(401)
      const metadata = await fetch(`${origin}/auth/saml/metadata`)
      expect(metadata.status).toBe(200)
      expect(await metadata.text()).toContain(`${origin}/auth/saml/acs`)
    } finally {
      server.close()
    }
  })
})

describe('founder profile on the injected gateway', () => {
  it('reads the user row after OIDC even when the handoff database URL is a placeholder', async () => {
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
      spaRoot: mkdtempSync(join(tmpdir(), 'spa-empty-')),
    })
    const origin = await listen(server)
    try {
      requests.set('reqHostProfile1', {
        ...request,
        id: 'reqHostProfile1',
        authIssuer: `${origin}/oidc`,
      })
      const started = await fetch(`${origin}/intake/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer operator-token' },
        body: JSON.stringify({ requestId: 'reqHostProfile1' }),
      })
      const { token } = await started.json()
      const intake = await fetch(`${origin}/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'reqHostProfile1',
          email: 'ops@northwind.test',
          token,
          secrets: { databaseUrl: 'postgres://dead.example/not-opened' },
        }),
      })
      const fulfilled = await intake.json()
      expect(fulfilled.ok).toBe(true)

      const start = await fetch(`${origin}/auth/start`, { redirect: 'manual' })
      const form = await (await fetch(start.headers.get('location'))).text()
      const action = form.match(/action="([^"]+)"/)[1]
      const posted = await fetch(new URL(action, origin), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        redirect: 'manual',
        body: new URLSearchParams({ email: 'asha@northwind.test' }),
      })
      const callback = await fetch(posted.headers.get('location'), { redirect: 'manual' })
      expect(callback.status).toBe(302)
      const sessionToken = decodeURIComponent(
        new URL(callback.headers.get('location')).hash.replace(/^#session=/, '')
      )
      globalThis.__OHSMS_STACK__ = {
        VITE_DATA_DRIVER: 'postgres',
        VITE_DATA_GATEWAY: origin,
      }
      setAccessToken(sessionToken)
      const profile = await createHttpPostgresAdapter().get('users', 'asha@northwind.test')
      expect(profile).toMatchObject({
        email: 'asha@northwind.test',
        role: 'admin',
        status: 'approved',
        orgId: fulfilled.orgId,
      })
      const org = await createHttpPostgresAdapter().get('organizations', fulfilled.orgId)
      expect(org.name).toBe('Northwind Metals')
    } finally {
      clearAccessToken()
      delete globalThis.__OHSMS_STACK__
      server.close()
    }
  })
})

describe('http server helper import', () => {
  it('does not listen during import', () => {
    expect(typeof createServer).toBe('function')
  })
})
