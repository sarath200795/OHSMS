import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { applySchema, createEngine } from '../../../stack/engine.mjs'
import { createFixtureIdp, readAuthnRequest } from '../../../stack/samlFixture.mjs'
import { configureKeycloak, certificateFromMetadata } from '../../../stack/keycloakAdmin.mjs'
import { s3Blobs } from '../../../stack/s3blob.mjs'
import { createOwnStackServer } from '../../../stack/server.mjs'
import { signSession } from '../../../stack/session.mjs'

const publicRequest = {
  id: 'reqLocalHost1',
  orgName: 'Local Metals',
  address: 'Pune',
  contactName: 'Asha Rao',
  contactEmail: 'asha@local.test',
  handoffContact: 'asha@local.test',
  mode: 'bring',
  engine: 'postgres',
  authMethod: 'saml',
  authIssuer: 'http://127.0.0.1:8080/realms/ohsms',
  authClientId: 'ohsms',
  bucketMode: 'bring',
  bucketName: 'ohsms',
  bucketRegion: 'us-east-1',
  presignUrl: 'http://127.0.0.1:8787/presign',
}

describe('self-hosted services', () => {
  it('stores an object through the S3 client and reads it back', async () => {
    const objects = new Map()
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      const key = decodeURIComponent(url.pathname.replace(/^\/ohsms\//, ''))
      if (!req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')) {
        res.writeHead(403)
        res.end()
        return
      }
      if (req.method === 'PUT' && url.pathname === '/ohsms') {
        res.writeHead(200)
        res.end()
        return
      }
      if (req.method === 'PUT') {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        objects.set(key, Buffer.concat(chunks))
        res.writeHead(200)
        res.end()
        return
      }
      if (req.method === 'GET') {
        const body = objects.get(key)
        if (!body) {
          res.writeHead(404)
          res.end()
          return
        }
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(body)
        return
      }
      if (req.method === 'HEAD') {
        res.writeHead(objects.has(key) ? 200 : 404)
        res.end()
        return
      }
      if (req.method === 'DELETE') {
        objects.delete(key)
        res.writeHead(204)
        res.end()
        return
      }
      res.writeHead(405)
      res.end()
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    try {
      const blobs = s3Blobs({
        endpoint: `http://127.0.0.1:${port}`,
        bucket: 'ohsms',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        now: () => new Date('2026-01-02T03:04:05Z'),
      })
      await blobs.ensureBucket()
      await blobs.set('orgs/org1/photos/a.png', {
        body: Buffer.from('png-bytes'),
        contentType: 'image/png',
      })
      expect(await blobs.has('orgs/org1/photos/a.png')).toBe(true)
      const stored = await blobs.get('orgs/org1/photos/a.png')
      expect(stored.body.toString()).toBe('png-bytes')
      await blobs.delete('orgs/org1/photos/a.png')
      expect(await blobs.has('orgs/org1/photos/a.png')).toBe(false)
    } finally {
      server.close()
    }
  })

  it('configures Keycloak without writing the password to the log', async () => {
    const seen = []
    const password = 'ephemeral-test-password'
    const fetchImpl = async (url, opts = {}) => {
      seen.push({ url: String(url), body: opts.body })
      if (String(url).endsWith('/token')) {
        return { ok: true, json: async () => ({ access_token: 'admin-access' }) }
      }
      if (String(url).endsWith('/admin/realms/ohsms') && opts.method === 'GET') {
        return { ok: false, status: 404, json: async () => ({}) }
      }
      if (String(url).endsWith('/admin/realms') && opts.method === 'POST') {
        return { ok: true, status: 201, json: async () => ({}) }
      }
      if (String(url).includes('/clients?')) {
        return { ok: true, json: async () => [] }
      }
      if (String(url).endsWith('/clients') && opts.method === 'POST') {
        return { ok: true, status: 201, json: async () => ({}) }
      }
      if (String(url).includes('/users?')) {
        return { ok: true, json: async () => [] }
      }
      if (String(url).endsWith('/users') && opts.method === 'POST') {
        return { ok: true, status: 201, json: async () => ({}) }
      }
      if (String(url).endsWith('/protocol/saml/descriptor')) {
        return {
          ok: true,
          text: async () =>
            '<EntityDescriptor><KeyDescriptor use="signing"><ds:X509Certificate>MIIB</ds:X509Certificate></KeyDescriptor></EntityDescriptor>',
        }
      }
      return { ok: false, status: 500, json: async () => ({}), text: async () => '' }
    }
    const logs = []
    const original = console.log
    console.log = (...args) => logs.push(args.join(' '))
    try {
      const result = await configureKeycloak({
        internalUrl: 'http://keycloak:8080',
        publicUrl: 'http://127.0.0.1:8080',
        adminUser: 'admin',
        adminPassword: password,
        realm: 'ohsms',
        clientId: 'ohsms',
        acsUrl: 'http://127.0.0.1:8787/auth/saml/acs',
        sloUrl: 'http://127.0.0.1:8787/auth/saml/slo',
        userEmail: 'asha@local.test',
        userPassword: password,
        fetchImpl,
      })
      expect(result.entryPoint).toBe('http://127.0.0.1:8080/realms/ohsms/protocol/saml')
      expect(result.cert).toContain('BEGIN CERTIFICATE')
      expect(certificateFromMetadata('<ds:X509Certificate>QQ==</ds:X509Certificate>')).toContain(
        'QQ=='
      )
      const clientPost = seen.find((call) => String(call.url).endsWith('/clients'))
      expect(String(clientPost.body)).toContain('http://127.0.0.1:8787/auth/saml/acs')
      expect(logs.join('\n')).not.toContain(password)
    } finally {
      console.log = original
    }
  })

  it('fulfills a loopback registration with server-held secrets and logs the user out through the IdP', async () => {
    const db = new PGlite()
    const engine = createEngine(db)
    const { key, cert } = createFixtureIdp()
    const databaseUrl = 'postgres://ohsms:not-for-the-browser@postgres:5432/ohsms'
    const secret = 'session-secret-for-the-test'
    let prepared = ''
    const server = createOwnStackServer({
      engine,
      db,
      sessionSecret: secret,
      origin: 'http://127.0.0.1',
      auth: {
        method: 'saml',
        clientId: 'ohsms',
        idpCert: cert,
        entryPoint: 'http://127.0.0.1:8080/realms/ohsms/protocol/saml',
        forceAuthn: true,
      },
      requests: new Map(),
      controlToken: 'operator-token',
      localFiling: true,
      heldSecrets: {
        databaseUrl,
        samlIdpCert: cert,
        samlEntryPoint: 'http://127.0.0.1:8080/realms/ohsms/protocol/saml',
        sessionSecret: secret,
      },
      prepareIdentity: async (request) => {
        prepared = request.contactEmail
      },
      publicEnv: {
        VITE_DATA_DRIVER: 'postgres',
        VITE_DATA_GATEWAY: 'http://127.0.0.1',
        VITE_AUTH_METHOD: 'saml',
        VITE_AUTH_ISSUER: 'http://127.0.0.1:8080/realms/ohsms',
        VITE_AUTH_CLIENT_ID: 'ohsms',
      },
      envExtras: { VITE_CONTROL_PLANE: 'local' },
      samlFixtureKey: key,
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    server.stackState.origin = origin
    try {
      const refused = await fetch(`${origin}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...publicRequest, databaseUrl }),
      })
      expect(refused.status).toBe(400)
      const metadata = await fetch(`${origin}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...publicRequest,
          id: 'reqMetadata01',
          authIssuer: 'http://169.254.169.254/latest/meta-data',
        }),
      })
      expect(metadata.status).toBe(400)
      expect((await metadata.json()).reason).toBe('url')
      const creds = await fetch(`${origin}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...publicRequest,
          id: 'reqCredsUrl01',
          authIssuer: 'http://user:pass@127.0.0.1:8080/realms/ohsms',
        }),
      })
      expect(creds.status).toBe(400)
      expect(JSON.stringify(await creds.json())).not.toContain('pass')
      const filed = await fetch(`${origin}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...publicRequest, presignUrl: `${origin}/presign` }),
      })
      const body = await filed.json()
      expect(filed.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.dedicatedUrl).toBe(origin)
      expect(JSON.stringify(body)).not.toContain(databaseUrl)
      expect(JSON.stringify(body)).not.toContain('BEGIN CERTIFICATE')
      expect(prepared).toBe('asha@local.test')
      const status = await fetch(
        `${origin}/registration-status?name=${encodeURIComponent(publicRequest.orgName)}`
      )
      expect(await status.json()).toEqual({
        found: true,
        status: 'live',
        dedicatedUrl: origin,
      })
      const again = await fetch(`${origin}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...publicRequest,
          id: 'reqLocalHost2',
          presignUrl: `${origin}/presign`,
        }),
      })
      const againBody = await again.json()
      expect(again.status).toBe(200)
      expect(againBody.already).toBe(true)
      expect(againBody.dedicatedUrl).toBe(origin)
      expect(JSON.stringify(againBody)).not.toContain(databaseUrl)
      const orgs = await engine.list({ role: 'ohsms_worker', uid: '' }, 'organizations', {})
      expect(orgs.filter((org) => org.name === publicRequest.orgName)).toHaveLength(1)
      const env = await (await fetch(`${origin}/stack-env.js`)).text()
      expect(env).toContain('"VITE_CONTROL_PLANE":"local"')
      expect(env).toContain('http://127.0.0.1:8080/realms/ohsms')
      expect(env).not.toContain(databaseUrl)

      const start = await fetch(`${origin}/auth/start`, { redirect: 'manual' })
      const parsed = readAuthnRequest(
        new URL(start.headers.get('location')).searchParams.get('SAMLRequest')
      )
      expect(parsed.id).toBeTruthy()
      const inflated = Buffer.from(
        new URL(start.headers.get('location')).searchParams.get('SAMLRequest'),
        'base64'
      )
      const { inflateRawSync } = await import('node:zlib')
      expect(inflateRawSync(inflated).toString('utf8')).toContain('ForceAuthn="true"')

      const session = signSession(secret, { sub: 'asha@local.test' })
      const logout = await fetch(`${origin}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session}` },
      })
      const out = await logout.json()
      expect(out.url).toContain('http://127.0.0.1:8080/realms/ohsms/protocol/saml')
      expect(out.url).toContain('SAMLRequest=')
      const slo = await fetch(`${origin}/auth/saml/slo`, { redirect: 'manual' })
      expect(slo.headers.get('location')).toBe(`${origin}/login`)
    } finally {
      server.close()
    }
  })

  it('records an identity refusal without saving an organization or the password', async () => {
    const db = new PGlite()
    await applySchema(db)
    const engine = createEngine(db)
    const databaseUrl = 'postgres://ohsms:not-for-the-browser@postgres:5432/ohsms'
    const logs = []
    const original = console.log
    console.log = (...args) => logs.push(args.map(String).join(' '))
    const server = createOwnStackServer({
      engine,
      db,
      sessionSecret: 'session-secret-for-the-test',
      origin: 'http://127.0.0.1',
      auth: { method: 'saml', clientId: 'ohsms' },
      requests: new Map(),
      localFiling: true,
      heldSecrets: { databaseUrl, sessionSecret: 'session-secret-for-the-test' },
      prepareIdentity: async () => {
        throw new Error('keycloak user was not created (400)')
      },
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    server.stackState.origin = origin
    try {
      const filed = await fetch(`${origin}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...publicRequest, presignUrl: `${origin}/presign` }),
      })
      const body = await filed.json()
      expect(filed.status).toBe(503)
      expect(body).toEqual({ ok: false, reason: 'identity' })
      const status = await (
        await fetch(
          `${origin}/registration-status?name=${encodeURIComponent(publicRequest.orgName)}`
        )
      ).json()
      expect(status).toEqual({ found: true, status: 'failed', reason: 'identity' })
      const orgs = await engine.list({ role: 'ohsms_worker', uid: '' }, 'organizations', {})
      expect(orgs).toEqual([])
      const text = logs.join('\n')
      expect(text).toContain('registration identity Local Metals')
      expect(text).not.toContain(databaseUrl)
      expect(text).not.toContain('asha@local.test')
      expect(text).not.toContain('400')
    } finally {
      console.log = original
      server.close()
    }
  })

  it('does not start a second organization while the first registration is running', async () => {
    const db = new PGlite()
    const engine = createEngine(db)
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    let started
    const startedP = new Promise((resolve) => {
      started = resolve
    })
    const server = createOwnStackServer({
      engine,
      db,
      sessionSecret: 'session-secret-for-the-test',
      origin: 'http://127.0.0.1',
      auth: { method: 'saml', clientId: 'ohsms' },
      requests: new Map(),
      localFiling: true,
      heldSecrets: {
        databaseUrl: 'postgres://ohsms:not-for-the-browser@postgres:5432/ohsms',
        sessionSecret: 'session-secret-for-the-test',
      },
      prepareIdentity: async () => {
        started()
        await gate
      },
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    server.stackState.origin = origin
    const body = { ...publicRequest, presignUrl: `${origin}/presign` }
    try {
      const first = fetch(`${origin}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      await startedP
      const second = await fetch(`${origin}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, id: 'reqLocalHost2' }),
      })
      expect(second.status).toBe(409)
      expect(await second.json()).toEqual({ ok: false, reason: 'in-progress' })
      const running = await (
        await fetch(
          `${origin}/registration-status?name=${encodeURIComponent(publicRequest.orgName)}`
        )
      ).json()
      expect(running).toEqual({ found: true, status: 'running' })
      release()
      expect((await first).status).toBe(200)
      const orgs = await engine.list({ role: 'ohsms_worker', uid: '' }, 'organizations', {})
      expect(orgs.filter((org) => org.name === publicRequest.orgName)).toHaveLength(1)
    } finally {
      release()
      server.close()
    }
  })

  it('writes service secrets without printing them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ohsms-secrets-'))
    const secrets = join(dir, 'secrets')
    const password = 'local-admin-password-not-a-default'
    const repo = fileURLToPath(new URL('../../../', import.meta.url))
    mkdirSync(secrets)
    writeFileSync(join(secrets, 'bootstrap-password'), `${password}\n`)
    chmodSync(join(secrets, 'bootstrap-password'), 0o600)
    const output = execFileSync('node', ['deploy/self-host/bootstrap.mjs', dir], {
      cwd: repo,
      encoding: 'utf8',
    })
    expect(output).not.toContain(password)
    const postgres = readFileSync(join(secrets, 'postgres-password'), 'utf8').trim()
    const compose = readFileSync(join(secrets, 'compose.env'), 'utf8')
    expect(postgres.length).toBeGreaterThan(16)
    expect(output).not.toContain(postgres)
    expect(compose).toContain(`POSTGRES_PASSWORD=${postgres}`)
    expect(compose).toContain('MINIO_ROOT_USER=ohsms')
    const again = execFileSync('node', ['deploy/self-host/bootstrap.mjs', dir], {
      cwd: repo,
      encoding: 'utf8',
    })
    expect(again).toContain('already exists')
    expect(readFileSync(join(secrets, 'postgres-password'), 'utf8').trim()).toBe(postgres)
  })
})
