// Dedicated-environment host. It is not a policy service: data calls set the
// session uid and run SQL, and RLS decides. Presign and the workers re-read
// the profile. The OIDC routes exist so a demo issuer can live on the same
// host; a company issuer is just the URL in the request.

import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { verifySession, signSession } from './session.mjs'
import { decidePresign } from './presign.mjs'
import { identityFromCode } from './oidc.mjs'
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
import { checkIntake, hashIntakeToken, newIntakeToken, takeSecrets } from './intake.mjs'
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

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks)
  if (!raw.length) return {}
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    return { __raw: raw.toString('utf8') }
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
        onAuthStart(url, res)
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
      if (req.method === 'POST' && url.pathname === '/intake/start') {
        await onIntakeStart(req, res)
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

  function onAuthStart(url, res) {
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

  async function onIntakeStart(req, res) {
    const body = await readBody(req)
    const request = requests.get(body.requestId)
    if (!request) {
      send(res, 404, { code: 'not-found', message: 'unknown request' })
      return
    }
    const email = String(body.email || '')
      .trim()
      .toLowerCase()
    const want = String(request.handoffContact || request.contactEmail || '')
      .trim()
      .toLowerCase()
    if (!email || email !== want) {
      send(res, 403, {
        code: 'permission-denied',
        message: 'that email is not the handoff contact',
      })
      return
    }
    const token = newIntakeToken()
    intake.set(request.id, { hash: hashIntakeToken(token), secrets: null })
    send(res, 200, { token })
  }

  async function onIntake(req, res) {
    const body = await readBody(req)
    const request = requests.get(body.requestId)
    const slot = intake.get(body.requestId)
    const gate = checkIntake({
      email: body.email,
      request,
      token: body.token,
      tokenHash: slot?.hash,
    })
    if (!gate.ok) {
      send(res, 403, { code: 'permission-denied', message: 'the handoff was refused' })
      return
    }
    const taken = takeSecrets(body.secrets)
    if (!taken.ok) {
      send(res, 400, { code: 'invalid-argument', message: 'nothing to store' })
      return
    }
    slot.secrets = taken.value
    send(res, 200, { ok: true })
  }

  async function onFulfill(req, res) {
    const header = String(req.headers.authorization || '')
    if (!controlToken || header !== `Bearer ${controlToken}`) {
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
    const result = await fulfillRequest({
      request,
      secrets: slot.secrets,
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
    const safe = { ...result }
    delete safe.sessionSecret
    send(res, result.ok ? 200 : 400, safe)
  }

  return server
}
