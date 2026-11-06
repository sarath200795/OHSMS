// Dedicated-environment host. It is not a policy service: data calls set the
// session uid and run SQL, and RLS decides. Presign and the workers re-read
// the profile. The OIDC routes exist so a demo issuer can live on the same
// host; a company issuer is just the URL in the request.

import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { verifySession, signSession } from './session.mjs'
import { allowedBlobType, decideBlobRead, decidePresign, MAX_BLOB_BYTES } from './presign.mjs'
import { identityFromCode } from './oidc.mjs'
import { identityFromSaml, samlClient } from './saml.mjs'
import {
  FIXTURE_CONTINUE_JS,
  readAuthnRequest,
  renderFixtureLogin,
  renderFixturePost,
  signSamlResponse,
} from './samlFixture.mjs'
import { identityFromSupabase } from './supabaseAuth.mjs'
import { establishIdentity } from './identity.mjs'
import {
  stampIdentity,
  completePasswordChange,
  releaseDataKeys,
  deleteOrgFile,
  runRetention,
  withdrawStaleMirrors,
  sweepLoto,
  productMail,
} from './workers.mjs'
import {
  checkIntake,
  handoffLink,
  handoffMessage,
  hashIntakeToken,
  newIntakeToken,
  publicOutcome,
  takePublicRequest,
  takeSecrets,
} from './intake.mjs'
import { renderHandoffForm, renderHandoffRefusal, renderHandoffResult } from './handoffPage.mjs'
import { fulfillRequest } from './fulfill.mjs'
import { stackEnvSource } from './publicEnv.mjs'
import { readSpaBody, resolveSpaRequest } from './spa.mjs'

const WORKER = { role: 'ohsms_worker', uid: '' }

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json',
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(payload)
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  const type = String(req.headers['content-type'] || '')
  if (type.includes('application/x-www-form-urlencoded')) {
    const out = {}
    for (const [key, value] of new URLSearchParams(raw)) out[key] = value
    return out
  }
  try {
    return JSON.parse(raw)
  } catch {
    return { __raw: raw }
  }
}

function sessionOf(req, secret) {
  const header = String(req.headers.authorization || '')
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  return verifySession(secret, token)
}

function challenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url')
}

const GRANT_MS = 10 * 60 * 1000
const DEFAULT_SPA_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

function sendBytes(res, status, body, headers) {
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', ...headers })
  res.end(body)
}

export function createOwnStackServer({
  engine,
  db,
  sessionSecret,
  auth = { method: 'oidc', issuer: '', clientId: '', clientSecret: '' },
  origin = '',
  dataKeyMaster = '',
  mail = null,
  blobs = new Map(),
  codes = new Map(),
  intake = new Map(),
  requests = new Map(),
  controlToken = '',
  spaRoot = DEFAULT_SPA_ROOT,
  samlFixtureKey = '',
}) {
  const state = {
    origin: String(origin || '').replace(/\/$/, ''),
    sessionSecret,
    master: dataKeyMaster,
    auth: { ...auth },
    publicEnv: null,
    saml: null,
    samlKey: '',
  }
  const uploads = new Map()
  // Tests listen on port 0 and then learn the address. Fulfillment, the SAML
  // callback and the presign URLs read this object, so the port can be written
  // once before the handoff runs.
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      if (req.method === 'GET' && url.pathname === '/health') {
        send(res, 200, { ok: true })
        return
      }
      if (req.method === 'POST' && url.pathname === '/data') {
        await onData(req, res)
        return
      }
      if (req.method === 'GET' && url.pathname === '/auth/start') {
        await onAuthStart(url, res, req)
        return
      }
      if (req.method === 'GET' && url.pathname === '/auth/callback') {
        await onCallback(url, res)
        return
      }
      if (url.pathname === '/auth/saml/acs') {
        await onSamlAcs(req, res)
        return
      }
      if (req.method === 'GET' && url.pathname === '/auth/saml/metadata') {
        onSamlMetadata(req, res)
        return
      }
      if (url.pathname === '/fixture/saml/sso' || url.pathname === '/fixture/saml/continue.js') {
        await onSamlFixture(req, res, url)
        return
      }
      if (req.method === 'POST' && url.pathname === '/auth/supabase') {
        await onSupabase(req, res)
        return
      }
      if (req.method === 'POST' && url.pathname === '/presign') {
        await onPresign(req, res)
        return
      }
      if (url.pathname === '/blob') {
        await onBlob(req, res, url)
        return
      }
      if (req.method === 'POST' && url.pathname.startsWith('/rpc/')) {
        await onRpc(req, res, url.pathname.slice('/rpc/'.length))
        return
      }
      if (
        url.pathname === '/oidc/.well-known/openid-configuration' ||
        url.pathname === '/.well-known/openid-configuration'
      ) {
        const base = `${state.origin}/oidc`
        send(res, 200, {
          issuer: `${state.origin}/oidc`,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          userinfo_endpoint: `${base}/userinfo`,
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
        })
        return
      }
      if (url.pathname === '/oidc/authorize') {
        await onAuthorize(req, res, url)
        return
      }
      if (req.method === 'POST' && url.pathname === '/oidc/token') {
        await onToken(req, res)
        return
      }
      if (req.method === 'GET' && url.pathname === '/oidc/userinfo') {
        onUserinfo(req, res)
        return
      }
      if (req.method === 'POST' && url.pathname === '/requests') {
        await onFile(req, res)
        return
      }
      if (req.method === 'POST' && url.pathname === '/intake/start') {
        await onIntakeStart(req, res)
        return
      }
      if (req.method === 'GET' && url.pathname === '/handoff') {
        onHandoffGet(url, res)
        return
      }
      if (req.method === 'POST' && url.pathname === '/handoff') {
        await onHandoffPost(req, res)
        return
      }
      if (req.method === 'POST' && url.pathname === '/intake') {
        await onIntake(req, res)
        return
      }
      if (req.method === 'POST' && url.pathname === '/fulfill') {
        await onFulfill(req, res)
        return
      }
      if (req.method === 'GET' && url.pathname === '/stack-env.js') {
        if (!state.publicEnv) {
          send(res, 404, { code: 'not-found', message: 'not found' })
          return
        }
        send(res, 200, stackEnvSource(state.publicEnv), {
          'Content-Type': 'text/javascript; charset=utf-8',
        })
        return
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && (await serveSpa(req, res, url))) {
        return
      }
      send(res, 404, { code: 'not-found', message: 'not found' })
    } catch (err) {
      send(res, 500, { code: err.code || 'internal', message: 'request failed' })
    }
  })

  async function onData(req, res) {
    const body = await readBody(req)
    const session = sessionOf(req, state.sessionSecret)
    const roleSession = { role: 'ohsms_browser', uid: session?.sub || '' }
    if (body.op === 'get') {
      const doc = await engine.get(roleSession, body.path, body.id, { rev: Boolean(body.rev) })
      send(res, 200, { doc })
      return
    }
    if (body.op === 'list') {
      const rows = await engine.list(roleSession, body.path, body.opts || {})
      send(res, 200, { rows })
      return
    }
    if (body.op === 'count') {
      const count = await engine.count(roleSession, body.path, body.opts || {})
      send(res, 200, { count })
      return
    }
    if (body.op === 'commit') {
      try {
        const result = await engine.commit(roleSession, body.ops || [], body.expect || [])
        send(res, 200, result)
      } catch (err) {
        send(res, err.code === 'permission-denied' ? 403 : 400, {
          code: err.code || 'unknown',
          message: err.message,
        })
      }
      return
    }
    send(res, 400, { code: 'invalid-argument', message: 'unknown op' })
  }

  async function onAuthStart(_url, res, req) {
    if (state.auth.method === 'saml') {
      const client = serviceProvider(req)
      if (!client) {
        send(res, 400, { code: 'failed-precondition', message: 'SAML is not configured' })
        return
      }
      const location = await client.getAuthorizeUrlAsync('')
      send(res, 302, '', { Location: location })
      return
    }
    const pending = randomBytes(16).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    codes.set(`state:${pending}`, { verifier, at: Date.now() })
    const issuer = state.auth.issuer || `${state.origin}/oidc`
    const redirect = `${state.origin}/auth/callback`
    const location = `${issuer.replace(/\/$/, '')}/authorize?response_type=code&client_id=${encodeURIComponent(state.auth.clientId || 'ohsms')}&redirect_uri=${encodeURIComponent(redirect)}&scope=openid%20email%20profile&state=${pending}&code_challenge=${challenge(verifier)}&code_challenge_method=S256`
    send(res, 302, '', { Location: location })
  }

  async function onCallback(url, res) {
    const oauthState = url.searchParams.get('state')
    const code = url.searchParams.get('code')
    const pending = codes.get(`state:${oauthState}`)
    codes.delete(`state:${oauthState}`)
    if (!pending || !code) {
      send(res, 400, { code: 'invalid-argument', message: 'sign-in could not be completed' })
      return
    }
    const issuer = (state.auth.issuer || `${state.origin}/oidc`).replace(/\/$/, '')
    const identity = await identityFromCode({
      tokenEndpoint: `${issuer}/token`,
      userinfoEndpoint: `${issuer}/userinfo`,
      clientId: state.auth.clientId || 'ohsms',
      clientSecret: state.auth.clientSecret || '',
      code,
      redirectUri: `${state.origin}/auth/callback`,
      verifier: pending.verifier,
    })
    if (!identity.ok) {
      send(res, 401, {
        code: 'unauthenticated',
        message: 'the identity provider refused the sign-in',
      })
      return
    }
    const established = await establishIdentity(engine, db, identity)
    if (!established.ok) {
      send(res, 403, { code: 'permission-denied', message: 'no account on this organization' })
      return
    }
    const token = signSession(state.sessionSecret, { sub: established.uid })
    const app = state.origin || '/'
    send(res, 302, '', { Location: `${app}/#session=${encodeURIComponent(token)}` })
  }

  async function onSupabase(req, res) {
    const body = await readBody(req)
    const identity = await identityFromSupabase({
      issuer: state.auth.issuer,
      anonKey: state.auth.anonKey,
      email: body.email,
      password: body.password,
    })
    if (!identity.ok) {
      send(res, 401, { code: 'unauthenticated', message: 'sign-in was refused' })
      return
    }
    const established = await establishIdentity(engine, db, identity)
    if (!established.ok) {
      send(res, 403, { code: 'permission-denied', message: 'no account on this organization' })
      return
    }
    send(res, 200, { token: signSession(state.sessionSecret, { sub: established.uid }) })
  }

  function selfOrigin(req) {
    const configured = state.origin
    const host = String(req.headers.host || '').trim()
    if (!configured || !host || /[\s/@]/.test(host)) return configured
    let configuredHost = ''
    try {
      configuredHost = new URL(configured).hostname
    } catch {
      return configured
    }
    const hostName = host.startsWith('[')
      ? host.slice(1, host.indexOf(']'))
      : host.replace(/:\d+$/, '')
    // A foreign Host must not mint an upload or ACS URL on someone else's origin.
    if (hostName !== configuredHost) return configured
    const proto = configured.startsWith('https:') ? 'https' : 'http'
    return `${proto}://${host}`
  }

  function grant(op, path) {
    const id = randomBytes(16).toString('hex')
    uploads.set(id, { op, path, exp: Date.now() + GRANT_MS })
    return id
  }

  function takeGrant(id, op, path) {
    const pending = uploads.get(id)
    uploads.delete(id)
    if (!pending || pending.op !== op || pending.path !== path || pending.exp < Date.now())
      return false
    return true
  }

  async function onPresign(req, res) {
    const body = await readBody(req)
    const session = sessionOf(req, state.sessionSecret)
    if (!session) {
      send(res, 401, { code: 'unauthenticated', message: 'sign in first' })
      return
    }
    const profile = await engine.get(WORKER, 'users', session.sub)
    const decision = decidePresign({ op: body.op, path: body.path, profile })
    if (!decision.ok) {
      send(res, 403, { code: 'permission-denied', message: 'refused' })
      return
    }
    const base = selfOrigin(req)
    const path = encodeURIComponent(body.path)
    if (body.op === 'delete') {
      // The adapter DELETEs deleteUrl. Deleting here made that request a 404
      // and left no record of the grant the profile check had just issued.
      const id = grant('delete', body.path)
      send(res, 200, { deleteUrl: `${base}/blob?path=${path}&id=${id}` })
      return
    }
    const id = grant('put', body.path)
    send(res, 200, {
      uploadUrl: `${base}/blob?path=${path}&id=${id}`,
      publicUrl: `${base}/blob?path=${path}`,
    })
  }

  async function onBlob(req, res, url) {
    const path = url.searchParams.get('path') || ''
    const id = url.searchParams.get('id') || ''
    if (req.method === 'PUT' || req.method === 'POST') {
      // Read before refusing. Leaving the body on a keep-alive socket makes the
      // next request on that connection look like part of this one.
      const chunks = []
      let size = 0
      let tooBig = false
      for await (const chunk of req) {
        size += chunk.length
        if (size > MAX_BLOB_BYTES) {
          tooBig = true
          continue
        }
        chunks.push(chunk)
      }
      if (tooBig) {
        send(res, 413, { code: 'invalid-argument', message: 'file is too large' })
        return
      }
      if (!takeGrant(id, 'put', path)) {
        send(res, 403, { code: 'permission-denied', message: 'upload was refused' })
        return
      }
      const type = String(req.headers['content-type'] || 'application/octet-stream')
      if (!allowedBlobType(type)) {
        send(res, 415, { code: 'invalid-argument', message: 'that file type is not stored' })
        return
      }
      if (blobs.has(path)) {
        send(res, 409, { code: 'already-exists', message: 'that object already exists' })
        return
      }
      const body = Buffer.concat(chunks)
      blobs.set(path, {
        body,
        contentType: type.split(';')[0].trim().toLowerCase(),
        size: body.length,
      })
      send(res, 200, { ok: true, path, size: body.length })
      return
    }
    if (req.method === 'DELETE') {
      if (!takeGrant(id, 'delete', path)) {
        send(res, 403, { code: 'permission-denied', message: 'delete was refused' })
        return
      }
      blobs.delete(path)
      send(res, 200, { ok: true })
      return
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const session = sessionOf(req, state.sessionSecret)
      if (!session) {
        send(res, 401, { code: 'unauthenticated', message: 'sign in first' })
        return
      }
      const profile = await engine.get(WORKER, 'users', session.sub)
      const decision = decideBlobRead({ path, profile })
      if (!decision.ok) {
        send(res, 403, { code: 'permission-denied', message: 'refused' })
        return
      }
      const stored = blobs.get(path)
      if (!stored) {
        send(res, 404, { code: 'not-found', message: 'not found' })
        return
      }
      sendBytes(res, 200, req.method === 'HEAD' ? undefined : stored.body, {
        'Content-Type': stored.contentType || 'application/octet-stream',
        'Content-Length': stored.body.length,
        'Cache-Control': 'private, no-store',
      })
      return
    }
    send(res, 405, { code: 'method-not-allowed', message: 'method not allowed' })
  }

  async function onRpc(req, res, name) {
    const body = await readBody(req)
    const session = sessionOf(req, state.sessionSecret)
    const uid = session?.sub || ''
    const idp = state.auth.method === 'oidc' || state.auth.method === 'saml'
    const table = {
      stampIdentity: () => stampIdentity(engine, uid),
      backfillClaims: () => stampIdentity(engine, uid),
      completePasswordChange: () =>
        completePasswordChange(engine, db, {
          uid,
          authTime: session?.authTime,
          current: body.current,
          password: body.password,
          idp,
        }),
      getDataKeys: () => releaseDataKeys(engine, { uid, master: state.master }),
      deleteOrgFile: () => deleteOrgFile(engine, blobs, { uid, path: body.path }),
      purgeSoftDeleted: () => runRetention(engine, { orgId: body.orgId }),
      withdrawStalePermitMirrors: () => withdrawStaleMirrors(engine),
      sweepLotoPermits: () => sweepLoto(engine, { orgId: body.orgId }),
      notifyIncidentReported: () => productMail(mail, body),
    }
    const fn = table[name]
    if (!fn) {
      send(res, 404, { code: 'not-found', message: 'no such job' })
      return
    }
    const result = await fn()
    send(res, result?.ok === false ? 403 : 200, result)
  }

  async function onAuthorize(req, res, url) {
    if (req.method === 'GET') {
      const q = url.search
      send(
        res,
        200,
        `<!doctype html><html><body><form method="post" action="/oidc/authorize${q}"><label>Work email <input name="email" type="email" autocomplete="username" required></label><button type="submit">Continue</button></form></body></html>`
      )
      return
    }
    const raw = await readBody(req)
    const email = String(raw.email || raw.__raw?.match(/email=([^&]+)/)?.[1] || '').trim()
    const oauthState = url.searchParams.get('state')
    const codeChallenge = url.searchParams.get('code_challenge')
    const redirect = url.searchParams.get('redirect_uri')
    if (!email || !oauthState || !codeChallenge || !redirect) {
      send(res, 400, { code: 'invalid-argument', message: 'incomplete authorization request' })
      return
    }
    const code = randomBytes(24).toString('base64url')
    codes.set(`code:${code}`, { email, challenge: codeChallenge, at: Date.now() })
    const back = new URL(redirect)
    back.searchParams.set('code', code)
    back.searchParams.set('state', oauthState)
    send(res, 302, '', { Location: back.toString() })
  }

  async function onToken(req, res) {
    const body = await readBody(req)
    const params = new URLSearchParams(body.__raw || '')
    const code = params.get('code') || body.code
    const verifier = params.get('code_verifier') || body.code_verifier
    const pending = codes.get(`code:${code}`)
    codes.delete(`code:${code}`)
    if (!pending || !verifier || challenge(verifier) !== pending.challenge) {
      send(res, 400, { error: 'invalid_grant' })
      return
    }
    const access = randomBytes(24).toString('base64url')
    codes.set(`access:${access}`, { email: pending.email, sub: pending.email })
    send(res, 200, { access_token: access, token_type: 'Bearer' })
  }

  function onUserinfo(req, res) {
    const header = String(req.headers.authorization || '')
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    const user = codes.get(`access:${token}`)
    if (!user) {
      send(res, 401, { code: 'unauthenticated', message: 'unknown token' })
      return
    }
    send(res, 200, { sub: user.sub, email: user.email, name: user.email })
  }

  function operator(req) {
    const header = String(req.headers.authorization || '')
    return Boolean(controlToken) && header === `Bearer ${controlToken}`
  }

  function contactOf(request) {
    return String(request?.handoffContact || request?.contactEmail || '')
      .trim()
      .toLowerCase()
  }

  function tokenMatches(request, token) {
    const slot = intake.get(request?.id)
    return checkIntake({
      email: contactOf(request),
      request,
      token,
      tokenHash: slot?.hash,
      used: slot?.used,
    }).ok
  }

  // Filing and starting intake share this. The token is mailed to the handoff
  // contact. It is returned to the operator only when that mail was not sent,
  // so the one showing is whichever channel actually delivered it.
  async function openIntake(request) {
    if (!request?.id) return { http: 404, body: { code: 'not-found', message: 'unknown request' } }
    if (request.status !== 'requested') {
      return {
        http: 409,
        body: {
          code: 'failed-precondition',
          message: 'that request is not waiting',
          reason: request.status === 'live' ? 'already-live' : 'status',
        },
      }
    }
    if (intake.get(request.id)?.secrets) {
      return {
        http: 409,
        body: {
          code: 'failed-precondition',
          message: 'secrets have already arrived',
          reason: 'already-ingested',
        },
      }
    }
    const to = contactOf(request)
    if (!to) {
      return {
        http: 400,
        body: { code: 'invalid-argument', message: 'no handoff contact', reason: 'email' },
      }
    }
    const token = newIntakeToken()
    const link = handoffLink({ origin: state.origin, requestId: request.id, token })
    if (!link.ok) {
      return {
        http: 400,
        body: {
          code: 'failed-precondition',
          message: 'the handoff link was not sent',
          reason: link.reason,
        },
      }
    }
    intake.set(request.id, { hash: hashIntakeToken(token), secrets: null, used: false })
    let sent = false
    if (mail) {
      const mailed = await mail(
        handoffMessage({ to, orgName: request.orgName, requestId: request.id, url: link.url })
      )
      sent = mailed?.sent === true
    }
    const body = { ok: true, emailed: sent, requestId: request.id }
    if (!sent) body.token = token
    return { http: 200, body }
  }

  async function ingest({ requestId, email, token, secrets }) {
    const request = requests.get(requestId)
    const slot = intake.get(requestId)
    const gate = checkIntake({
      email,
      request,
      token,
      tokenHash: slot?.hash,
      used: slot?.used,
    })
    if (!gate.ok) {
      return {
        http: 403,
        body: {
          ok: false,
          code: 'permission-denied',
          message: 'the handoff was refused',
          reason: gate.reason,
        },
      }
    }
    const taken = takeSecrets(secrets)
    if (!taken.ok) {
      return {
        http: 400,
        body: {
          ok: false,
          code: 'invalid-argument',
          message: 'nothing to store',
          reason: taken.reason,
        },
      }
    }
    // Consume before the await. A second request with the same token must not
    // pass the check while fulfillment is still running.
    slot.used = true
    slot.hash = null
    slot.secrets = taken.value
    return runFulfill(request, slot.secrets)
  }

  async function runFulfill(request, secrets) {
    let result
    try {
      result = await fulfillRequest({
        request,
        secrets,
        engine,
        db,
        admin: {
          update: async (id, patch) => {
            const current = requests.get(id)
            requests.set(id, { ...current, ...patch })
          },
        },
        mail,
        dedicatedUrl: state.origin,
        gatewayUrl: state.origin,
      })
    } catch {
      return { http: 500, body: { ok: false, reason: 'fulfill' } }
    }
    if (result?.ok) adoptLive(request, secrets, result)
    const body = publicOutcome(result, secrets)
    return { http: body.ok ? 200 : 400, body }
  }

  async function onFile(req, res) {
    if (!operator(req)) {
      send(res, 401, { code: 'unauthenticated', message: 'operator token required' })
      return
    }
    const body = await readBody(req)
    const accepted = takePublicRequest(body)
    if (!accepted.ok) {
      send(res, 400, {
        code: 'invalid-argument',
        message: 'request refused',
        reason: accepted.reason,
      })
      return
    }
    const prior = requests.get(accepted.value.id)
    if (prior?.status === 'live' || intake.get(accepted.value.id)?.secrets) {
      send(res, 409, {
        code: 'failed-precondition',
        message: 'that request is no longer waiting',
        reason: prior?.status === 'live' ? 'already-live' : 'already-ingested',
      })
      return
    }
    requests.set(accepted.value.id, accepted.value)
    const opened = await openIntake(requests.get(accepted.value.id))
    send(res, opened.http, opened.body)
  }

  async function onIntakeStart(req, res) {
    if (!operator(req)) {
      send(res, 401, { code: 'unauthenticated', message: 'operator token required' })
      return
    }
    const body = await readBody(req)
    const request = requests.get(body.requestId)
    if (!request) {
      send(res, 404, { code: 'not-found', message: 'unknown request' })
      return
    }
    const opened = await openIntake(request)
    send(res, opened.http, opened.body)
  }

  function onHandoffGet(url, res) {
    const requestId = url.searchParams.get('request') || ''
    const token = url.searchParams.get('token') || ''
    const request = requests.get(requestId)
    if (!tokenMatches(request, token)) {
      send(res, 403, renderHandoffRefusal())
      return
    }
    send(res, 200, renderHandoffForm({ requestId, token, orgName: request.orgName }))
  }

  async function onHandoffPost(req, res) {
    const body = await readBody(req)
    const requestId = body.request || body.requestId
    const outcome = await ingest({
      requestId,
      email: body.email,
      token: body.token,
      secrets: body,
    })
    const request = requests.get(requestId)
    send(
      res,
      outcome.http,
      renderHandoffResult({
        ok: outcome.body.ok,
        orgName: request?.orgName,
        dedicatedUrl: outcome.body.dedicatedUrl,
        reason: outcome.body.reason,
      })
    )
  }

  async function onIntake(req, res) {
    const body = await readBody(req)
    const outcome = await ingest({
      requestId: body.requestId,
      email: body.email,
      token: body.token,
      secrets: body.secrets,
    })
    send(res, outcome.http, outcome.body)
  }

  async function onFulfill(req, res) {
    if (!operator(req)) {
      send(res, 401, { code: 'unauthenticated', message: 'operator token required' })
      return
    }
    const body = await readBody(req)
    const request = requests.get(body.requestId)
    const slot = intake.get(body.requestId)
    if (!request || !slot?.secrets) {
      send(res, 400, { code: 'failed-precondition', message: 'secrets have not arrived' })
      return
    }
    const outcome = await runFulfill(request, slot.secrets)
    send(res, outcome.http, outcome.body)
  }

  function spIssuer() {
    return state.auth.clientId || 'ohsms'
  }

  function serviceProvider(req) {
    if (state.auth.method !== 'saml') return null
    const cert = state.auth.idpCert
    const entry = state.auth.entryPoint
    if (!cert || !entry) return null
    const issuer = spIssuer()
    const callbackUrl = `${selfOrigin(req)}/auth/saml/acs`
    const key = `${issuer}|${callbackUrl}|${entry}|${cert}`
    if (state.samlKey !== key) {
      // always: the assertion has to answer an AuthnRequest this process
      // issued. A captured response cannot be replayed at ACS after the id
      // is consumed, and a response that never started here is refused.
      state.saml = samlClient({
        issuer,
        callbackUrl,
        idpCert: cert,
        entryPoint: entry,
        validateInResponseTo: 'always',
      })
      state.samlKey = key
    }
    return state.saml
  }

  function adoptLive(request, secrets, result) {
    state.publicEnv = result.publicEnv
    if (request?.authMethod) state.auth.method = request.authMethod
    if (request?.authIssuer) state.auth.issuer = request.authIssuer
    if (request?.authClientId) state.auth.clientId = request.authClientId
    if (secrets?.oidcClientSecret) state.auth.clientSecret = secrets.oidcClientSecret
    if (secrets?.samlIdpCert) state.auth.idpCert = secrets.samlIdpCert
    if (secrets?.samlEntryPoint) state.auth.entryPoint = secrets.samlEntryPoint
    if (secrets?.supabaseAnonKey) state.auth.anonKey = secrets.supabaseAnonKey
    if (secrets?.dataKeyMaster) state.master = secrets.dataKeyMaster
    if (secrets?.sessionSecret) state.sessionSecret = secrets.sessionSecret
    state.saml = null
    state.samlKey = ''
  }

  function finishSession(res, established) {
    if (!established.ok) {
      send(res, 403, { code: 'permission-denied', message: 'no account on this organization' })
      return
    }
    const token = signSession(state.sessionSecret, { sub: established.uid })
    const app = state.origin || '/'
    send(res, 302, '', { Location: `${app}/#session=${encodeURIComponent(token)}` })
  }

  async function onSamlAcs(req, res) {
    if (req.method !== 'POST') {
      send(res, 405, { code: 'method-not-allowed', message: 'method not allowed' })
      return
    }
    const client = serviceProvider(req)
    if (!client) {
      send(res, 400, { code: 'failed-precondition', message: 'SAML is not configured' })
      return
    }
    const body = await readBody(req)
    const samlResponse = body.SAMLResponse
    if (!samlResponse) {
      send(res, 400, { code: 'invalid-argument', message: 'sign-in could not be completed' })
      return
    }
    const identity = await identityFromSaml(client, samlResponse)
    if (!identity.ok) {
      send(res, 401, {
        code: 'unauthenticated',
        message: 'the identity provider refused the sign-in',
      })
      return
    }
    finishSession(res, await establishIdentity(engine, db, identity))
  }

  function onSamlMetadata(req, res) {
    const client = serviceProvider(req)
    if (!client) {
      send(res, 404, { code: 'not-found', message: 'SAML is not configured' })
      return
    }
    send(res, 200, client.generateServiceProviderMetadata(null, null), {
      'Content-Type': 'application/xml; charset=utf-8',
    })
  }

  async function onSamlFixture(req, res, url) {
    if (!samlFixtureKey) {
      send(res, 404, { code: 'not-found', message: 'not found' })
      return
    }
    if (url.pathname === '/fixture/saml/continue.js') {
      send(res, 200, FIXTURE_CONTINUE_JS, { 'Content-Type': 'text/javascript; charset=utf-8' })
      return
    }
    const acs = `${selfOrigin(req)}/auth/saml/acs`
    if (req.method === 'GET') {
      const samlRequest = url.searchParams.get('SAMLRequest') || ''
      if (!samlRequest) {
        send(res, 400, { code: 'invalid-argument', message: 'incomplete authorization request' })
        return
      }
      send(
        res,
        200,
        renderFixtureLogin({
          action: '/fixture/saml/sso',
          samlRequest,
          relayState: url.searchParams.get('RelayState') || '',
        })
      )
      return
    }
    if (req.method !== 'POST') {
      send(res, 405, { code: 'method-not-allowed', message: 'method not allowed' })
      return
    }
    const body = await readBody(req)
    const email = String(body.email || '').trim()
    const parsed = readAuthnRequest(body.SAMLRequest)
    if (!email || !parsed.id || parsed.acs !== acs || parsed.issuer !== spIssuer()) {
      send(res, 400, { code: 'invalid-argument', message: 'incomplete authorization request' })
      return
    }
    const samlResponse = signSamlResponse({
      key: samlFixtureKey,
      cert: state.auth.idpCert,
      audience: spIssuer(),
      acsUrl: acs,
      nameId: email,
      inResponseTo: parsed.id,
    })
    send(
      res,
      200,
      renderFixturePost({
        acsUrl: acs,
        samlResponse,
        relayState: String(body.RelayState || '').slice(0, 200),
      })
    )
  }

  async function serveSpa(req, res, url) {
    if (!state.publicEnv) return false
    const hit = await resolveSpaRequest(spaRoot, url.pathname)
    if (hit.kind === 'forbidden' || hit.kind === 'missing') {
      send(res, 404, { code: 'not-found', message: 'not found' })
      return true
    }
    if (hit.kind === 'unbuilt') {
      send(res, 404, {
        code: 'not-found',
        message: 'the application build is not on this host',
      })
      return true
    }
    const file = await readSpaBody(hit)
    sendBytes(res, 200, req.method === 'HEAD' ? undefined : file.body, {
      'Content-Type': file.type,
      'Cache-Control': file.hashed ? 'public, max-age=31536000, immutable' : 'no-store',
    })
    return true
  }

  server.stackState = state
  return server
}
