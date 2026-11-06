// Demo provision for one own-stack organization.
//
//   node stack/demo-provision.mjs
//   node stack/demo-provision.mjs --saml
//
// Starts a dedicated host on 127.0.0.1 with an embedded Postgres and the
// sample company from the script. The default is a local OIDC issuer.
// `--saml` adds a fixture IdP in this process: paste the printed certificate
// and entry point into the handoff form. The private key is not printed and
// is not an intake field. It does not call registerOrganization and it does
// not write to the shared Firebase project. Sign in at the printed URL with
// the contact email. The database password is not on the page: this demo has
// none, because the browser role never receives a connection string.
//
// A real request uses the same path. POST /requests emails the handoff
// contact a one-time link. Submitting that page runs fulfillRequest.
// Status is updated by this server, not by a browser write to
// provisioningRequests. The link below is the demo's copy of that mail.
//
// After that page says the organization is live, `/` serves `dist/` if
// `npm run build` has been run. The host injects this company's public env.
// Do not set VITE_DATA_DRIVER=postgres on the shared Firebase build.

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { createEngine } from './engine.mjs'
import { createFixtureIdp } from './samlFixture.mjs'
import { createOwnStackServer } from './server.mjs'

const saml = process.argv.includes('--saml')
const fixture = saml ? createFixtureIdp() : null

const request = {
  id: 'reqDemoNorth1',
  status: 'requested',
  orgName: 'Northwind Metals',
  address: 'Pune',
  contactName: 'Asha Rao',
  contactEmail: 'asha@northwind.test',
  handoffContact: 'asha@northwind.test',
  mode: 'weehs-operated',
  engine: 'postgres',
  authMethod: saml ? 'saml' : 'oidc',
  authIssuer: '',
  authClientId: 'ohsms',
  bucketMode: 'provision',
  presignUrl: '',
}

const db = new PGlite()
const engine = createEngine(db)
const origin = 'http://127.0.0.1:8787'
if (!saml) request.authIssuer = `${origin}/oidc`
const server = createOwnStackServer({
  engine,
  db,
  sessionSecret: 'demo-session-secret-not-a-database-password',
  origin,
  auth: saml
    ? { method: 'saml', clientId: 'ohsms' }
    : { method: 'oidc', issuer: '', clientId: 'ohsms' },
  samlFixtureKey: fixture?.key || '',
  requests: new Map(),
  controlToken: 'demo-operator',
  dataKeyMaster: 'demo-data-key-master-not-in-the-browser',
  mail: async (message) => {
    console.log(`To: ${message.to}`)
    console.log(message.subject)
    console.log(message.text)
    console.log('')
    return { sent: true }
  },
})

await new Promise((resolve) => server.listen(8787, '127.0.0.1', resolve))

const filed = await fetch(`${origin}/requests`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer demo-operator',
  },
  body: JSON.stringify(request),
})
const body = await filed.json()
if (!filed.ok || !body.emailed || body.token) {
  console.error('handoff mail was not sent', body.reason || body)
  process.exit(1)
}

console.log('Open the one-time link printed above.')
if (saml) {
  console.log(`Submit ${request.handoffContact}, this entry point, and this IdP certificate:`)
  console.log(origin + '/fixture/saml/sso')
  console.log(fixture.cert.trim())
  console.log('The private key stays in this process.')
} else {
  console.log(`Submit ${request.handoffContact} and any one secret field.`)
}
const distIndex = fileURLToPath(new URL('../dist/index.html', import.meta.url))
if (existsSync(distIndex)) {
  console.log(`When that page says the organization is live, open ${origin}`)
} else {
  console.log('dist/index.html is not built, so the dedicated URL 404s until `npm run build`.')
  console.log('That build must not be the shared Firebase deploy with VITE_DATA_DRIVER=postgres.')
}
console.log(`Sign in as ${request.contactEmail}.`)
console.log('The shared Firebase build is unchanged. Stop this process with Ctrl-C.')
