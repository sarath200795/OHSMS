// Dedicated-environment host. It is not a policy service: data calls set the
// session uid and run SQL, and RLS decides. Presign and the workers re-read
// the profile. The OIDC routes exist so a demo issuer can live on the same
// host; a company issuer is just the URL in the request. Company SAML has no
// demo IdP here: the host is only ever the service provider.

import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { verifySession, signSession } from './session.mjs'
import { decidePresign } from './presign.mjs'
import { identityFromCode } from './oidc.mjs'
import { identityFromSupabase } from './supabaseAuth.mjs'
import { samlClient, identityFromSaml } from './saml.mjs'
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

// Every route that reads a body is reachable before any session exists
// (/handoff, /intake, /auth/saml, /auth/supabase), so an uncapped read lets
// anyone hold an arbitrary upload in this process's memory. The cap sits above
// the largest legitimate body: a /data commit carrying an inline file of up to
// MAX_INLINE_BYTES (700 KB) as base64, with room for the rest of the batch.
export const MAX_BODY_BYTES = 4 * 1024 * 1024

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      const err = new Error('body too large')
      err.code = 'payload-too-large'
      throw err
    }
    chunks.push(chunk)
  }
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
}) {
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
        await onAuthStart(url, res)
        return
      }
      if (req.method === 'POST' && url.pathname === '/auth/saml') {
        await onSaml(req, res)
        return
      }
      if (req.method === 'GET' && url.pathname === '/auth/callback') {
        await onCallback(url, res)
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
      if (req.method === 'POST' && url.pathname.startsWith('/rpc/')) {
        await onRpc(req, res, url.pathname.slice('/rpc/'.length))
        return
      }
      if (
        url.pathname === '/oidc/.well-known/openid-configuration' ||
        url.pathname === '/.well-known/openid-configuration'
      ) {
        const base = `${origin || ''}/oidc`
        send(res, 200, {
          issuer: `${origin}/oidc`,
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
      send(res, 404, { code: 'not-found', message: 'not found' })
    } catch (err) {
      if (err.code === 'payload-too-large') {
        send(res, 413, { code: err.code, message: 'request too large' }, { Connection: 'close' })
        return
      }
      send(res, 500, { code: err.code || 'internal', message: 'request failed' })
    }
  })

  async function onData(req, res) {
    const body = await readBody(req)
    const session = sessionOf(req, sessionSecret)
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

  // One client for the life of the configuration. The AuthnRequest ids it
  // issues are held in its own cache, and /auth/saml accepts a response only
  // for one of those ids, so a fresh client per request would refuse every
  // sign-in.
  let saml = null
  function samlFor() {
    if (!saml) {
      saml = samlClient({
        issuer: auth.clientId || 'ohsms',
        callbackUrl: `${origin}/auth/saml`,
        idpCert: auth.idpCert,
        entryPoint: auth.entryPoint,
      })
    }
    return saml
  }

  async function onAuthStart(url, res) {
    if (auth.method === 'saml') {
      let location
      try {
        location = await samlFor().getAuthorizeUrlAsync('', {})
      } catch {
        send(res, 503, { code: 'unavailable', message: 'single sign-on is not configured' })
        return
      }
      send(res, 302, '', { Location: location })
      return
    }
    const state = randomBytes(16).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    codes.set(`state:${state}`, { verifier, at: Date.now() })
    const issuer = auth.issuer || `${origin}/oidc`
    const redirect = `${origin}/auth/callback`
    const location = `${issuer.replace(/\/$/, '')}/authorize?response_type=code&client_id=${encodeURIComponent(auth.clientId || 'ohsms')}&redirect_uri=${encodeURIComponent(redirect)}&scope=openid%20email%20profile&state=${state}&code_challenge=${challenge(verifier)}&code_challenge_method=S256`
    send(res, 302, '', { Location: location })
  }

  async function onCallback(url, res) {
    const state = url.searchParams.get('state')
    const code = url.searchParams.get('code')
    const pending = codes.get(`state:${state}`)
    codes.delete(`state:${state}`)
    if (!pending || !code) {
      send(res, 400, { code: 'invalid-argument', message: 'sign-in could not be completed' })
      return
    }
    const issuer = (auth.issuer || `${origin}/oidc`).replace(/\/$/, '')
    const identity = await identityFromCode({
      tokenEndpoint: `${issuer}/token`,
      userinfoEndpoint: `${issuer}/userinfo`,
      clientId: auth.clientId || 'ohsms',
      clientSecret: auth.clientSecret || '',
      code,
      redirectUri: `${origin}/auth/callback`,
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
    const token = signSession(sessionSecret, { sub: established.uid })
    const app = origin || '/'
    send(res, 302, '', { Location: `${app}/#session=${encodeURIComponent(token)}` })
  }

  async function onSaml(req, res) {
    if (auth.method !== 'saml') {
      send(res, 404, { code: 'not-found', message: 'not found' })
      return
    }
    const body = await readBody(req)
    const identity = await identityFromSaml(samlFor(), String(body.SAMLResponse || ''))
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
    const token = signSession(sessionSecret, { sub: established.uid })
    const app = origin || '/'
    send(res, 302, '', { Location: `${app}/#session=${encodeURIComponent(token)}` })
  }

  async function onSupabase(req, res) {
    const body = await readBody(req)
    const identity = await identityFromSupabase({
      issuer: auth.issuer,
      anonKey: auth.anonKey,
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
    send(res, 200, { token: signSession(sessionSecret, { sub: established.uid }) })
  }

  async function onPresign(req, res) {
    const body = await readBody(req)
    const session = sessionOf(req, sessionSecret)
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
    if (body.op === 'delete') {
      blobs.delete(body.path)
      send(res, 200, { deleteUrl: `${origin}/blob?path=${encodeURIComponent(body.path)}` })
      return
    }
    const id = randomBytes(8).toString('hex')
    send(res, 200, {
      uploadUrl: `${origin}/blob?path=${encodeURIComponent(body.path)}&id=${id}`,
      publicUrl: `${origin}/blob?path=${encodeURIComponent(body.path)}`,
    })
  }

  async function onRpc(req, res, name) {
    const body = await readBody(req)
    const session = sessionOf(req, sessionSecret)
    const uid = session?.sub || ''
    const idp = auth.method === 'oidc' || auth.method === 'saml'
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
      getDataKeys: () => releaseDataKeys(engine, { uid, master: dataKeyMaster }),
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
    const state = url.searchParams.get('state')
    const codeChallenge = url.searchParams.get('code_challenge')
    const redirect = url.searchParams.get('redirect_uri')
    if (!email || !state || !codeChallenge || !redirect) {
      send(res, 400, { code: 'invalid-argument', message: 'incomplete authorization request' })
      return
    }
    const code = randomBytes(24).toString('base64url')
    codes.set(`code:${code}`, { email, challenge: codeChallenge, at: Date.now() })
    const back = new URL(redirect)
    back.searchParams.set('code', code)
    back.searchParams.set('state', state)
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
    const link = handoffLink({ origin, requestId: request.id, token })
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
        dedicatedUrl: origin,
        gatewayUrl: origin,
      })
    } catch {
      return { http: 500, body: { ok: false, reason: 'fulfill' } }
    }
    const body = publicOutcome(result, secrets)
    // The IdP certificate and entry point arrive on the handoff and nowhere
    // else: they are not on the request and not in the public env. Once the
    // environment is live, this host is that company's service provider, so it
    // takes them from the intake it just accepted.
    if (body.ok && request.authMethod === 'saml') {
      auth = {
        ...auth,
        method: 'saml',
        clientId: request.authClientId || auth.clientId,
        idpCert: secrets.samlIdpCert,
        entryPoint: secrets.samlEntryPoint,
      }
      saml = null
    }
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

  return server
}
