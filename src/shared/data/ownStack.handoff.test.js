import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { createEngine } from '../../../stack/engine.mjs'
import { ALLOWED, handoffLink, hashIntakeToken, takePublicRequest } from '../../../stack/intake.mjs'
import { renderHandoffForm, renderHandoffResult } from '../../../stack/handoffPage.mjs'
import { createOwnStackServer } from '../../../stack/server.mjs'

const operator = {
  'Content-Type': 'application/json',
  Authorization: 'Bearer operator-token',
}

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
  bucketName: '',
  bucketRegion: '',
  presignUrl: '',
}

const databaseUrl = 'postgres://browser.example/northwind'
const master = 'master-secret-value-not-for-the-request'
const clientSecret = 'oidc-client-secret-value'

function linkFrom(message) {
  const raw = message.text.match(/https?:\/\/\S+/)
  return new URL(raw[0])
}

async function boot({ db = null, engine = null, publicOrigin = 'https://handoff.example' } = {}) {
  const requests = new Map()
  const intake = new Map()
  const sent = []
  const server = createOwnStackServer({
    engine,
    db,
    sessionSecret: 'session-secret-for-the-test',
    origin: publicOrigin,
    auth: { method: 'oidc', issuer: '', clientId: 'ohsms' },
    requests,
    intake,
    controlToken: 'operator-token',
    mail: async (message) => {
      sent.push(message)
      return { sent: true }
    },
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    requests,
    intake,
    sent,
    listen: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

describe('own-stack handoff link', () => {
  it('refuses loopback http on a hosted control plane', async () => {
    const host = await boot()
    try {
      const filed = await fetch(`${host.listen}/requests`, {
        method: 'POST',
        headers: operator,
        body: JSON.stringify({
          ...request,
          id: 'reqLoopback001',
          authIssuer: 'http://127.0.0.1:8080/realms/ohsms',
          bucketMode: 'bring',
          bucketName: 'ohsms',
          bucketRegion: 'us-east-1',
          presignUrl: 'http://127.0.0.1:8787/presign',
        }),
      })
      expect(filed.status).toBe(400)
      const body = await filed.json()
      expect(body.reason).toBe('url')
      expect(JSON.stringify(body)).not.toContain('127.0.0.1')
      expect(host.requests.has('reqLoopback001')).toBe(false)
      const status = await fetch(`${host.listen}/registration-status?name=Northwind%20Metals`)
      expect(status.status).toBe(404)
    } finally {
      await host.close()
    }
  })

  it('emails the token once, then the handoff page fulfills without an operator', async () => {
    const db = new PGlite()
    const host = await boot({ db, engine: createEngine(db) })
    try {
      const anon = await fetch(`${host.listen}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      expect(anon.status).toBe(401)
      expect(host.sent).toHaveLength(0)

      const poisoned = await fetch(`${host.listen}/requests`, {
        method: 'POST',
        headers: operator,
        body: JSON.stringify({ ...request, id: 'reqPoisoned01', databaseUrl }),
      })
      expect(poisoned.status).toBe(400)
      const poisonedBody = await poisoned.json()
      expect(poisonedBody.reason).toBe('secret')
      expect(JSON.stringify(poisonedBody)).not.toContain(databaseUrl)
      expect(host.requests.has('reqPoisoned01')).toBe(false)
      expect(host.sent).toHaveLength(0)

      const filed = await fetch(`${host.listen}/requests`, {
        method: 'POST',
        headers: operator,
        body: JSON.stringify(request),
      })
      expect(filed.status).toBe(200)
      const filedBody = await filed.json()
      expect(filedBody).toEqual({ ok: true, emailed: true, requestId: request.id })
      expect(host.sent).toHaveLength(1)
      const handoff = host.sent[0]
      expect(handoff.to).toBe('ops@northwind.test')
      const link = linkFrom(handoff)
      const token = link.searchParams.get('token')
      expect(link.origin + link.pathname).toBe('https://handoff.example/handoff')
      expect(link.searchParams.get('request')).toBe(request.id)
      expect(handoff.text.split(token).length - 1).toBe(1)
      expect(JSON.stringify(filedBody)).not.toContain(token)
      expect(handoff.text).not.toContain(databaseUrl)
      expect(handoff.text).not.toContain(master)
      const slot = host.intake.get(request.id)
      expect(slot).toMatchObject({ used: false, secrets: null })
      expect(slot.hash).toBe(hashIntakeToken(token))
      expect(JSON.stringify(slot)).not.toContain(token)

      const dead = await fetch(
        `${host.listen}/handoff?request=${request.id}&token=${encodeURIComponent('dead-token-value')}`
      )
      expect(dead.status).toBe(403)
      expect(await dead.text()).not.toContain('dead-token-value')

      const page = await fetch(
        `${host.listen}/handoff?request=${request.id}&token=${encodeURIComponent(token)}`
      )
      expect(page.status).toBe(200)
      const html = await page.text()
      for (const key of ALLOWED) expect(html).toContain(`name="${key}"`)
      expect(html).not.toContain('name="password"')

      const wrong = await fetch(`${host.listen}/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: request.id,
          email: 'other@northwind.test',
          token,
          secrets: { databaseUrl, dataKeyMaster: master, oidcClientSecret: clientSecret },
        }),
      })
      expect(wrong.status).toBe(403)
      const wrongBody = await wrong.json()
      expect(wrongBody.reason).toBe('email')
      expect(JSON.stringify(wrongBody)).not.toContain(master)
      expect(JSON.stringify(wrongBody)).not.toContain(databaseUrl)
      expect(host.requests.get(request.id).status).toBe('requested')
      expect(host.intake.get(request.id).used).toBe(false)

      const bogus = await fetch(`${host.listen}/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: request.id,
          email: 'ops@northwind.test',
          token: 'not-the-one',
          secrets: { dataKeyMaster: master },
        }),
      })
      expect(bogus.status).toBe(403)
      expect((await bogus.json()).reason).toBe('token')
      expect(host.requests.get(request.id).status).toBe('requested')

      const form = new URLSearchParams()
      form.set('request', request.id)
      form.set('token', token)
      form.set('email', 'ops@northwind.test')
      form.set('databaseUrl', databaseUrl)
      form.set('dataKeyMaster', master)
      form.set('oidcClientSecret', clientSecret)
      form.set('password', 'should-be-dropped')
      const posted = await fetch(`${host.listen}/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      })
      expect(posted.status).toBe(200)
      const done = await posted.text()
      expect(done).toContain('https://handoff.example')
      expect(done).toContain('Organization is live')
      expect(done).not.toContain(databaseUrl)
      expect(done).not.toContain(master)
      expect(done).not.toContain(clientSecret)
      expect(done).not.toContain('should-be-dropped')
      expect(done).not.toContain(token)
      const stored = host.requests.get(request.id)
      expect(stored.status).toBe('live')
      expect(stored.secretsReceived).toBe(true)
      expect(stored.dedicatedUrl).toBe('https://handoff.example')
      expect(stored.databaseUrl).toBeUndefined()
      expect(stored.dataKeyMaster).toBeUndefined()
      expect(JSON.stringify(stored)).not.toContain(databaseUrl)
      expect(JSON.stringify(stored)).not.toContain(master)
      expect(JSON.stringify(stored)).not.toContain(clientSecret)
      expect(JSON.stringify(stored)).not.toContain('should-be-dropped')
      expect(host.intake.get(request.id).secrets.password).toBeUndefined()
      expect(host.intake.get(request.id).secrets.databaseUrl).toBe(databaseUrl)

      const ready = host.sent.find((message) => message.subject.includes('is ready'))
      expect(ready.to).toBe('asha@northwind.test')
      expect(ready.text).toContain('https://handoff.example')
      expect(ready.text).not.toContain(token)
      expect(ready.text).not.toContain(databaseUrl)
      expect(ready.text).not.toContain(master)

      const reuse = await fetch(`${host.listen}/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      })
      expect(reuse.status).toBe(403)
      const refused = await reuse.text()
      expect(refused).toContain('already used')
      expect(refused).not.toContain(master)
      expect(refused).not.toContain(token)
      expect(host.requests.get(request.id).status).toBe('live')
    } finally {
      await host.close()
    }
  })

  it('fulfills an existing request from POST /intake after the handoff mail', async () => {
    const db = new PGlite()
    const host = await boot({ db, engine: createEngine(db) })
    try {
      const existing = {
        ...request,
        id: 'reqHarbor0001',
        orgName: 'Harbor Works',
        contactEmail: 'mina@harbor.test',
        handoffContact: '',
      }
      host.requests.set(existing.id, existing)
      const started = await fetch(`${host.listen}/intake/start`, {
        method: 'POST',
        headers: operator,
        body: JSON.stringify({ requestId: existing.id }),
      })
      expect(started.status).toBe(200)
      const startedBody = await started.json()
      expect(startedBody.emailed).toBe(true)
      expect(startedBody.token).toBeUndefined()
      const handoff = host.sent[0]
      expect(handoff.to).toBe('mina@harbor.test')
      const token = linkFrom(handoff).searchParams.get('token')
      expect(handoff.text.split(token).length - 1).toBe(1)
      expect(JSON.stringify(startedBody)).not.toContain(token)

      const intake = await fetch(`${host.listen}/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: existing.id,
          email: 'mina@harbor.test',
          token,
          secrets: { databaseUrl, dataKeyMaster: master },
        }),
      })
      expect(intake.status).toBe(200)
      const outcome = await intake.json()
      expect(outcome).toMatchObject({
        ok: true,
        status: 'live',
        dedicatedUrl: 'https://handoff.example',
      })
      expect(outcome.sessionSecret).toBeUndefined()
      expect(outcome.publicEnv).toBeUndefined()
      expect(JSON.stringify(outcome)).not.toContain(databaseUrl)
      expect(JSON.stringify(outcome)).not.toContain(master)
      const stored = host.requests.get(existing.id)
      expect(stored.status).toBe('live')
      expect(JSON.stringify(stored)).not.toContain(databaseUrl)
      expect(JSON.stringify(stored)).not.toContain(master)

      const again = await fetch(`${host.listen}/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: existing.id,
          email: 'mina@harbor.test',
          token,
          secrets: { dataKeyMaster: master },
        }),
      })
      expect(again.status).toBe(403)
      expect((await again.json()).reason).toBe('reused')
    } finally {
      await host.close()
    }
  })

  it('refuses a missing database secret and does not put it on the request', async () => {
    const host = await boot()
    try {
      const bring = {
        ...request,
        id: 'reqBring00001',
        mode: 'bring',
        engine: 'postgres',
        contactEmail: 'a@keel.test',
        handoffContact: 'ops@keel.test',
      }
      const filed = await fetch(`${host.listen}/requests`, {
        method: 'POST',
        headers: operator,
        body: JSON.stringify(bring),
      })
      expect(filed.status).toBe(200)
      const token = linkFrom(host.sent[0]).searchParams.get('token')
      const sessionSecret = 'bring-session-secret-value'
      const intake = await fetch(`${host.listen}/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: bring.id,
          email: 'ops@keel.test',
          token,
          secrets: { sessionSecret },
        }),
      })
      expect(intake.status).toBe(400)
      const outcome = await intake.json()
      expect(outcome.reason).toBe('database')
      expect(outcome.ok).toBe(false)
      expect(JSON.stringify(outcome)).not.toContain(sessionSecret)
      const stored = host.requests.get(bring.id)
      expect(stored.status).toBe('requested')
      expect(stored.secretsReceived).toBeUndefined()
      expect(JSON.stringify(stored)).not.toContain(sessionSecret)

      const retry = await fetch(`${host.listen}/fulfill`, {
        method: 'POST',
        headers: operator,
        body: JSON.stringify({ requestId: bring.id }),
      })
      expect(retry.status).toBe(400)
      const retried = await retry.json()
      expect(retried.reason).toBe('database')
      expect(JSON.stringify(retried)).not.toContain(sessionSecret)
      expect(host.requests.get(bring.id).status).toBe('requested')
      expect(JSON.stringify(host.requests.get(bring.id))).not.toContain(sessionSecret)
    } finally {
      await host.close()
    }
  })

  it('does not mint a token for a public http origin', async () => {
    const host = await boot({ publicOrigin: 'http://files.example' })
    try {
      host.requests.set(request.id, { ...request })
      const started = await fetch(`${host.listen}/intake/start`, {
        method: 'POST',
        headers: operator,
        body: JSON.stringify({ requestId: request.id }),
      })
      expect(started.status).toBe(400)
      const body = await started.json()
      expect(body.reason).toBe('https')
      expect(body.token).toBeUndefined()
      expect(host.intake.size).toBe(0)
      expect(host.sent).toHaveLength(0)
    } finally {
      await host.close()
    }
  })

  it('builds an https handoff link and refuses secret fields on a request', () => {
    expect(
      handoffLink({ origin: 'https://app.example', requestId: 'reqNorthwind1', token: 'abc' }).url
    ).toBe('https://app.example/handoff?request=reqNorthwind1&token=abc')
    expect(
      handoffLink({ origin: 'http://127.0.0.1:8787', requestId: 'reqNorthwind1', token: 'abc' }).ok
    ).toBe(true)
    expect(
      handoffLink({ origin: 'http://files.example', requestId: 'reqNorthwind1', token: 'abc' })
        .reason
    ).toBe('https')
    expect(takePublicRequest({ ...request, status: 'live' }).reason).toBe('status')
    expect(takePublicRequest({ ...request, dataKeyMaster: master }).reason).toBe('secret')
    const wizard = readFileSync(
      new URL('../../pages/auth/OwnStackRequest.jsx', import.meta.url),
      'utf8'
    )
    expect(wizard).not.toMatch(/type="password"|databaseUrl|dataKeyMaster/)
    expect(wizard).toMatch(/one-time secure link/)
    expect(wizard).not.toMatch(/does not send email yet/)
    const form = renderHandoffForm({
      requestId: 'reqNorthwind1',
      token: 'tok',
      orgName: 'Northwind <Metals>',
    })
    expect(form).toContain('Northwind &lt;Metals&gt;')
    expect(form).not.toContain('<Metals>')
    const result = renderHandoffResult({
      ok: true,
      orgName: 'Northwind <Metals>',
      dedicatedUrl: 'https://handoff.example',
    })
    expect(result).toContain('https://handoff.example')
    expect(result).not.toContain('<Metals>')
    expect(result).not.toContain(master)
  })
})
