// Demo provision for one own-stack organization.
//
//   node stack/demo-provision.mjs
//
// Starts a dedicated host on 127.0.0.1 with an embedded Postgres, a local OIDC
// issuer, and the sample company from the script. It does not call
// registerOrganization and it does not write to the shared Firebase project.
// Sign in at the printed URL with the contact email. The database password is
// not on the page: this demo has none, because the browser role never receives
// a connection string.
//
// A real request uses the same fulfillRequest path. Secrets arrive at
// POST /intake on the control plane, and status is updated by that server,
// not by a browser write to provisioningRequests.

import { PGlite } from '@electric-sql/pglite'
import { createEngine } from './engine.mjs'
import { createOwnStackServer } from './server.mjs'

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
  authMethod: 'oidc',
  authIssuer: '',
  authClientId: 'ohsms',
  bucketMode: 'provision',
  presignUrl: '',
}

const db = new PGlite()
const engine = createEngine(db)
const requests = new Map([[request.id, request]])
const server = createOwnStackServer({
  engine,
  db,
  sessionSecret: 'demo-session-secret-not-a-database-password',
  origin: 'http://127.0.0.1:8787',
  auth: { method: 'oidc', issuer: '', clientId: 'ohsms' },
  requests,
  controlToken: 'demo-operator',
  dataKeyMaster: 'demo-data-key-master-not-in-the-browser',
})

await new Promise((resolve) => server.listen(8787, '127.0.0.1', resolve))
const origin = 'http://127.0.0.1:8787'
request.authIssuer = `${origin}/oidc`

const started = await fetch(`${origin}/intake/start`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ requestId: request.id, email: request.handoffContact }),
})
const { token } = await started.json()
await fetch(`${origin}/intake`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    requestId: request.id,
    email: request.handoffContact,
    token,
    secrets: { sessionSecret: 'demo-session-secret-not-a-database-password' },
  }),
})
const fulfilled = await fetch(`${origin}/fulfill`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer demo-operator' },
  body: JSON.stringify({ requestId: request.id }),
})
const body = await fulfilled.json()
if (!body.ok) {
  console.error('provision failed', body.reason || body)
  process.exit(1)
}

console.log(`Dedicated URL: ${origin}`)
console.log(`Sign in as ${request.contactEmail}`)
console.log(`Request ${request.id} is ${requests.get(request.id).status}`)
console.log('The shared Firebase build is unchanged. Stop this process with Ctrl-C.')
