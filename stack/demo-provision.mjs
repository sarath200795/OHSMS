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
// A real request uses the same path. POST /requests emails the handoff
// contact a one-time link. Submitting that page runs fulfillRequest.
// Status is updated by this server, not by a browser write to
// provisioningRequests. The link below is the demo's copy of that mail.

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
const origin = 'http://127.0.0.1:8787'
request.authIssuer = `${origin}/oidc`
const server = createOwnStackServer({
  engine,
  db,
  sessionSecret: 'demo-session-secret-not-a-database-password',
  origin,
  auth: { method: 'oidc', issuer: '', clientId: 'ohsms' },
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
console.log(`Submit ${request.handoffContact} and any one secret field.`)
console.log(`When that page says the organization is live, sign in at ${origin}`)
console.log(`as ${request.contactEmail}.`)
console.log('The shared Firebase build is unchanged. Stop this process with Ctrl-C.')
