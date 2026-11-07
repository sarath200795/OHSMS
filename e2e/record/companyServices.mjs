// The company's half of an own-stack walkthrough, on loopback.
//
// A company that registers with its own database, its own SAML and its own
// storage brings three things WEEHS does not run: an identity provider, a
// bucket, and the presign endpoint in front of that bucket. These are local
// stand-ins for those three, plus the dedicated host (stack/server.mjs) on an
// embedded Postgres, so the whole path can be driven and recorded on one
// machine. Nothing here talks to the shared Firebase project.
//
// The presign endpoint does not decide who may write. It asks the dedicated
// host (`POST /presign`), which re-reads the caller's live profile — the S-19
// rule in docs/CUSTOM-STACK.md — and only then hands out a URL into the
// company bucket.

import { createServer } from 'node:http'
import { createServer as createTlsServer } from 'node:https'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { createEngine } from '../../stack/engine.mjs'
import { createOwnStackServer } from '../../stack/server.mjs'
import { makeIdpKeys, readAuthnRequest, signedResponse } from '../support/samlIdp.mjs'

/**
 * A throwaway certificate for the company's public-looking hostnames. The
 * wizard (rightly) refuses a plain-http presign endpoint, so the company's
 * services are served over TLS at the names a real company would use, and the
 * recording browser maps those names to loopback.
 */
export function makeTls(hostnames) {
  const dir = mkdtempSync(join(tmpdir(), 'company-tls-'))
  const key = join(dir, 'key.pem')
  const cert = join(dir, 'cert.pem')
  execFileSync(
    'openssl',
    [
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
      `/CN=${hostnames[0]}`,
      '-addext',
      `subjectAltName=${hostnames.map((h) => `DNS:${h}`).join(',')}`,
    ],
    { stdio: 'ignore' }
  )
  const out = { key: readFileSync(key), cert: readFileSync(cert) }
  rmSync(dir, { recursive: true, force: true })
  return out
}

function serve(tls, handler) {
  return tls ? createTlsServer(tls, handler) : createServer(handler)
}

function listen(server, port) {
  return new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
}

async function bodyOf(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

// Query values reach these pages from the URL, so they are escaped before
// they land in an attribute: this IdP is a stand-in, not an XSS sink.
const attr = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const page = (title, inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f2a43;color:#0f172a;display:grid;place-items:center;min-height:100vh}
  .card{background:#fff;border-radius:14px;padding:32px 36px;width:380px;box-shadow:0 20px 50px rgba(0,0,0,.35)}
  .brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;color:#0f2a43;margin-bottom:6px}
  .dot{width:28px;height:28px;border-radius:7px;background:linear-gradient(135deg,#f59e0b,#b45309)}
  p{color:#475569;font-size:14px;margin:4px 0 20px}
  label{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}
  input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:15px}
  button{margin-top:22px;width:100%;padding:11px;border:0;border-radius:8px;background:#b45309;color:#fff;font-weight:600;font-size:15px;cursor:pointer}
  small{display:block;margin-top:16px;color:#64748b;font-size:12px}
</style></head><body><main class="card">${inner}</main></body></html>`

/**
 * The company's SAML IdP. Sign-in form at /sso; posts a signed response to the
 * ACS URL named in the AuthnRequest. Demo users are accepted by email and any
 * password: the point is the SAML leg, not this IdP's password check.
 */
export async function startCompanyIdp({ port, entityId, publicUrl, tls }) {
  const keys = makeIdpKeys('northwind-idp')
  const server = serve(tls, async (req, res) => {
    const url = new URL(req.url, publicUrl)
    if (req.method === 'GET' && url.pathname === '/sso') {
      const samlRequest = url.searchParams.get('SAMLRequest') || ''
      const relay = url.searchParams.get('RelayState') || ''
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        page(
          'Northwind Metals sign-in',
          `<div class="brand"><span class="dot"></span>Northwind Metals</div>
           <p>Company single sign-on (SAML 2.0)</p>
           <form method="post" action="/sso">
             <input type="hidden" name="SAMLRequest" value="${attr(samlRequest)}">
             <input type="hidden" name="RelayState" value="${attr(relay)}">
             <label for="email">Work email</label><input id="email" name="email" type="email" required>
             <label for="password">Password</label><input id="password" name="password" type="password" required>
             <button type="submit">Sign in</button>
           </form>
           <small>Identity provider operated by the company, not by WEEHS.</small>`
        )
      )
      return
    }
    if (req.method === 'POST' && url.pathname === '/sso') {
      const form = new URLSearchParams((await bodyOf(req)).toString('utf8'))
      const authn = readAuthnRequest(form.get('SAMLRequest'))
      const email = String(form.get('email') || '')
        .trim()
        .toLowerCase()
      const response = signedResponse({
        keys,
        request: authn,
        idpEntityId: entityId,
        email,
        name: email === 'asha@northwind.test' ? 'Asha Rao' : email,
      })
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        page(
          'Signing in…',
          `<div class="brand"><span class="dot"></span>Northwind Metals</div><p>Returning to the application…</p>
           <form id="f" method="post" action="${attr(authn.acs)}"><input type="hidden" name="SAMLResponse" value="${response}"></form>
           <script>setTimeout(()=>document.getElementById('f').submit(),900)</script>`
        )
      )
      return
    }
    res.writeHead(404).end()
  })
  await listen(server, port)
  return { server, cert: keys.cert, entryPoint: `${publicUrl}/sso` }
}

/**
 * The company's bucket and its presign endpoint. Bytes live in this process.
 * CORS is open to the dedicated app origin only.
 */
export async function startCompanyBucket({ port, appOrigin, hostUrl, publicUrl, tls }) {
  const objects = new Map()
  const tickets = new Map()
  const base = publicUrl
  const cors = {
    'Access-Control-Allow-Origin': appOrigin,
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  }
  const server = serve(tls, async (req, res) => {
    const url = new URL(req.url, base)
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end()
      return
    }
    if (req.method === 'POST' && url.pathname === '/presign') {
      const raw = await bodyOf(req)
      const decision = await fetch(`${hostUrl}/presign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: String(req.headers.authorization || ''),
        },
        body: raw,
      })
      if (!decision.ok) {
        res.writeHead(decision.status, { ...cors, 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ code: 'permission-denied' }))
        return
      }
      const { op, path } = JSON.parse(raw.toString('utf8'))
      const key = encodeURIComponent(path)
      if (op === 'delete') {
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ deleteUrl: `${base}/o/${key}` }))
        return
      }
      const ticket = randomBytes(12).toString('hex')
      tickets.set(ticket, path)
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          uploadUrl: `${base}/o/${key}?ticket=${ticket}`,
          publicUrl: `${base}/o/${key}`,
        })
      )
      return
    }
    if (url.pathname.startsWith('/o/')) {
      const path = decodeURIComponent(url.pathname.slice(3))
      if (req.method === 'PUT') {
        const ticket = url.searchParams.get('ticket')
        if (tickets.get(ticket) !== path) {
          res.writeHead(403, cors).end()
          return
        }
        tickets.delete(ticket)
        objects.set(path, {
          type: String(req.headers['content-type'] || 'application/octet-stream'),
          bytes: await bodyOf(req),
        })
        res.writeHead(200, cors).end()
        return
      }
      if (req.method === 'GET') {
        const obj = objects.get(path)
        if (!obj) {
          res.writeHead(404, cors).end()
          return
        }
        res.writeHead(200, { ...cors, 'Content-Type': obj.type })
        res.end(obj.bytes)
        return
      }
      if (req.method === 'DELETE') {
        objects.delete(path)
        res.writeHead(204, cors).end()
        return
      }
    }
    res.writeHead(404, cors).end()
  })
  await listen(server, port)
  return { server, objects, presignUrl: `${base}/presign`, bucketUrl: base }
}

/**
 * The control plane and dedicated host for one company, on an embedded
 * Postgres. `origin` is the dedicated app URL the host advertises; the Vite
 * server for that app proxies the host's routes, so the session redirect and
 * the SAML ACS land on the same origin as the app.
 */
export async function startDedicatedHost({ port, origin, controlToken }) {
  const db = new PGlite()
  const engine = createEngine(db)
  const mailbox = []
  const requests = new Map()
  const server = createOwnStackServer({
    engine,
    db,
    sessionSecret: randomBytes(24).toString('hex'),
    origin,
    auth: { method: 'oidc', issuer: '', clientId: '' },
    requests,
    controlToken,
    dataKeyMaster: randomBytes(24).toString('hex'),
    mail: async (message) => {
      mailbox.push(message)
      return { sent: true }
    },
  })
  await listen(server, port)
  return { server, db, engine, mailbox, requests, url: `http://127.0.0.1:${port}` }
}
