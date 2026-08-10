// ─────────────────────────────────────────────────────────────────────────────
// Push the working-tree firestore.rules into an already-running emulator.
//
// The emulator loads the rules file when it starts and, in a long dev session,
// goes on serving that copy. Edit the rules, and everything you then check by
// hand — the app in the browser, a script, a curl — is answered by the OLD
// ruleset. It has bitten this project twice, and both times the symptom was the
// worst possible one: a security change appearing to work.
//
// The unit tests do NOT have this problem. `initializeTestEnvironment` uploads
// the rules file into a throwaway project per run, so `npm run test:rules` is
// always testing the file on disk. That is exactly why a green suite is not
// evidence that the emulator you are clicking around in agrees.
//
//   npm run emulators:rules
//   node scripts/reload-emulator-rules.mjs --project other-project
//
// Local only, and deliberately so — there is no equivalent endpoint on a real
// project. Rules reach production through `firebase deploy --only
// firestore:rules`, which is reviewed and logged. See docs/PRODUCTION.md §0b.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const env = process.env
const HOST = flag('host', env.VITE_EMULATOR_HOST || '127.0.0.1')
const PORT = Number(flag('port', env.VITE_EMULATOR_FIRESTORE_PORT || 8080))
// Matches the default the app and the seed scripts use.
const PROJECT = flag('project', env.VITE_FIREBASE_PROJECT_ID || 'ohsms-demo')

const LOCAL = ['127.0.0.1', 'localhost', '::1', '0.0.0.0']
if (!LOCAL.includes(HOST)) {
  console.error(`\nRefusing to talk to "${HOST}". This endpoint exists only on the emulator.`)
  console.error('Real projects take rules through `firebase deploy --only firestore:rules`.\n')
  process.exit(1)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const file = flag('rules', join(root, 'firestore.rules'))

let content
try {
  content = readFileSync(file, 'utf8')
} catch {
  console.error(`\nCould not read ${file}\n`)
  process.exit(1)
}

const url = `http://${HOST}:${PORT}/emulator/v1/projects/${PROJECT}:securityRules`

let res
try {
  res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }),
  })
} catch (e) {
  // Much the likeliest failure, and the message the emulator itself does not give.
  console.error(`\nNo Firestore emulator answering on ${HOST}:${PORT} — is it running?`)
  console.error(`  npm run emulators\n(${e.message})\n`)
  process.exit(1)
}

const body = await res.text()
if (!res.ok) {
  // A compile error comes back here rather than as a thrown exception, and it
  // names the line — worth printing whole rather than summarising.
  console.error(`\nThe emulator rejected the rules (HTTP ${res.status}):\n${body}\n`)
  process.exit(1)
}

const lines = content.split('\n').length
console.log(`Loaded ${file.replace(root, '.')} (${lines} lines) into ${PROJECT} on ${HOST}:${PORT}`)
