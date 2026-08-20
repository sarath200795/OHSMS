// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap the platform grant — /platformAdmins/{uid}.
//
//   node scripts/grant-platform-admin.mjs <uid>          # emulators
//   node scripts/grant-platform-admin.mjs <uid> --prod   # prints console steps
//
// The grant is what makes /platform reachable and its writes accepted. It is
// deliberately unwritable from the app — see the /platformAdmins block in
// firestore.rules — so there is no signed-in path to create the first one, and
// there is not supposed to be. That is the property this file exists to respect
// rather than route around.
//
// Against the EMULATOR it writes the document directly through the emulator's
// own REST endpoint, which bypasses rules by design. That is safe because the
// emulator holds nothing real, and it makes local development a one-liner.
//
// Against a REAL project it writes nothing. It prints the exact document to
// create in the Firebase console, because creating it there requires
// project-level access — which is the same authority the collection stands in
// for. A script that could do it from a laptop with an app credential would be
// a hole in the thing it is bootstrapping.
// ─────────────────────────────────────────────────────────────────────────────
const env = process.env
const args = process.argv.slice(2)
const uid = args.find((a) => !a.startsWith('-'))
const prod = args.includes('--prod') || (env.VITE_USE_EMULATORS ?? 'true') === 'false'

const PROJECT = env.VITE_FIREBASE_PROJECT_ID || 'ohsms-demo'
const HOST = env.VITE_EMULATOR_HOST || '127.0.0.1'
const PORT = Number(env.VITE_EMULATOR_FIRESTORE_PORT) || 8080

if (!uid) {
  console.error(
    '\nUsage: node scripts/grant-platform-admin.mjs <uid> [--prod]\n\n' +
    'The uid is the Firebase Auth UID of the account that should operate the\n' +
    'platform. Find it in the Firebase console under Authentication → Users.\n'
  )
  process.exit(1)
}

const note = args.includes('--note') ? args[args.indexOf('--note') + 1] : 'platform operator'

if (prod) {
  console.log(`
Refusing to write to the real project — and that is the design, not a limitation.

Create this document by hand in the Firebase console. It takes three clicks and
requires project access, which is exactly the authority the platform grant
represents:

  Project      ${PROJECT}
  Collection   platformAdmins
  Document ID  ${uid}
  Fields       note (string)  ${note}

Nothing else is needed — the grant IS the document's existence; the field is
only there so the next person to read the console knows whose uid it is.

Then sign in at /platform/login with that account — the operator's own door.
The customer app has no link to it, and the account needs no organization: give
it none, so it can never be mistaken for a member of one.

To revoke, delete the document. Open tabs lose the console within seconds — the
client watches the document rather than reading it once.
`)
  process.exit(0)
}

// The emulator accepts "owner" as a bearer token and skips rules entirely.
const url =
  `http://${HOST}:${PORT}/v1/projects/${PROJECT}/databases/(default)/documents/platformAdmins/${uid}`

const res = await fetch(url, {
  method: 'PATCH',
  headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: { note: { stringValue: note } } }),
}).catch((err) => {
  console.error(`\nCould not reach the Firestore emulator at ${HOST}:${PORT}.`)
  console.error('Start it first:  npm run emulators\n')
  console.error(err.message)
  process.exit(1)
})

if (!res.ok) {
  console.error(`\nEmulator refused the write (${res.status}): ${await res.text()}\n`)
  process.exit(1)
}

console.log(`\n✓ platformAdmins/${uid} created in the emulator (project ${PROJECT}).`)
console.log('  Sign in at /platform/login with that account.\n')
