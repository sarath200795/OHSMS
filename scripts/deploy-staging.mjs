// ─────────────────────────────────────────────────────────────────────────────
// Deploy to staging from a laptop, safely.
//
// This exists because CI cannot deploy staging today: the service account is
// refused `iam.serviceAccounts.actAs` on the App Engine default account, which
// blocks the FUNCTIONS step and therefore the whole workflow. Deploying by hand
// works — but by hand is exactly how the dangerous mistake happens, and it
// already happened once during setup:
//
//   `firebase deploy --only hosting` ships whatever is in dist/. dist/ is
//   whatever `npm run build` last produced. That build reads .env.production.
//   So a hand-run hosting deploy put a bundle wired to the PRODUCTION Firebase
//   project onto the staging URL — staging address, production data.
//
// Nothing warns about that. The bundle is valid, the deploy succeeds, and the
// site works — against the wrong database. So this script never reuses dist/:
// it always rebuilds with staging configuration first.
//
// ── Where the configuration comes from ───────────────────────────────────────
//
// The GitHub repository variables, read through `gh`. Not a local .env file,
// deliberately — a second copy of the config is a second thing to drift, and
// the whole STAGING_ naming convention exists because a stale value silently
// resolving to production is the failure mode being designed against. One
// source of truth, and it is the one CI will use when CI is fixed.
//
// ── The guard ────────────────────────────────────────────────────────────────
//
// Same one deploy-staging.yml applies, for the same reason: refuse if the
// staging project id is missing or equal to production's. A hand-run deploy has
// no reviewer, so the check matters MORE here, not less.
//
// Usage:
//   npm run deploy:staging              build + rules/indexes/storage + hosting
//   npm run deploy:staging -- --functions   also deploy functions first
//
// Functions are opt-in because they take ten minutes, change rarely, and are
// already deployed. The order when they are included is the one PRODUCTION.md
// §0b requires: functions → rules → hosting.
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process'

const PROJECT_VAR = 'STAGING_FIREBASE_PROJECT_ID'
const PROD_VAR = 'VITE_FIREBASE_PROJECT_ID'

/** Every repository variable, as a plain object. */
function repoVariables() {
  const raw = execFileSync('gh', ['variable', 'list', '--json', 'name,value'], {
    encoding: 'utf8',
    // gh is a .cmd shim on Windows and will not spawn without a shell.
    shell: process.platform === 'win32',
  })
  return Object.fromEntries(JSON.parse(raw).map((v) => [v.name, v.value]))
}

/**
 * The build environment, mapped from STAGING_* to the VITE_* names the app
 * reads.
 *
 * Every key the app consults is set EXPLICITLY, including the ones that are
 * empty. Vite gives a real environment variable priority over a .env file, so
 * naming a key here is what stops .env.production supplying it — and a key left
 * unnamed is exactly how a production value reaches a staging build. That is
 * audit finding LOW-12's shape, and it is why this list is exhaustive rather
 * than only the interesting ones.
 */
function buildEnv(vars) {
  return {
    VITE_USE_EMULATORS: 'false',
    VITE_FIREBASE_PROJECT_ID: vars[PROJECT_VAR] || '',
    VITE_FIREBASE_API_KEY: vars.STAGING_FIREBASE_API_KEY || '',
    VITE_FIREBASE_AUTH_DOMAIN: vars.STAGING_FIREBASE_AUTH_DOMAIN || '',
    VITE_FIREBASE_STORAGE_BUCKET: vars.STAGING_FIREBASE_STORAGE_BUCKET || '',
    VITE_FIREBASE_MESSAGING_SENDER_ID: vars.STAGING_FIREBASE_MESSAGING_SENDER_ID || '',
    VITE_FIREBASE_APP_ID: vars.STAGING_FIREBASE_APP_ID || '',
    VITE_APPCHECK_SITE_KEY: vars.STAGING_APPCHECK_SITE_KEY || '',
    VITE_GOOGLE_MAPS_API_KEY: vars.STAGING_GOOGLE_MAPS_API_KEY || '',
    // Its own DSN or none. Sentry tags every event with import.meta.env.MODE,
    // which is "production" for any vite build — so the production DSN here
    // would file staging noise in the production inbox under the production
    // label, and the first thing that costs is trust in the alerts.
    VITE_SENTRY_DSN: vars.STAGING_SENTRY_DSN || '',
    VITE_ENCRYPTION: vars.STAGING_ENCRYPTION || 'off',
    VITE_FIREBASE_DATABASE_ID: '',
    VITE_OFFLINE_CACHE: 'false',
  }
}

const run = (cmd, args, env) => execFileSync(cmd, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, ...(env || {}) },
})

const vars = repoVariables()
const staging = vars[PROJECT_VAR]
const production = vars[PROD_VAR]

// The guard, before anything is built or uploaded.
if (!staging) {
  console.error(`\n${PROJECT_VAR} is not set. Refusing to deploy.\n`)
  process.exit(1)
}
if (staging === production) {
  console.error(`\n${PROJECT_VAR} equals the production project (${production}). Refusing.\n`)
  process.exit(1)
}
if (!vars.STAGING_FIREBASE_API_KEY) {
  // Not fatal in principle, but a bundle without it initialises no Firebase at
  // all: the deploy succeeds and every screen fails to sign in. Better to stop.
  console.error('\nSTAGING_FIREBASE_API_KEY is not set — the site would deploy and fail to sign in. Refusing.\n')
  process.exit(1)
}

const withFunctions = process.argv.includes('--functions')

console.log(`\nStaging target: ${staging} (production is ${production})`)
console.log(`Encryption: ${vars.STAGING_ENCRYPTION || 'off'}`)
console.log(`Functions: ${withFunctions ? 'yes' : 'skipped (pass --functions)'}\n`)

console.log('→ Building with staging configuration…')
run('npm', ['run', 'build'], buildEnv(vars))

if (withFunctions) {
  console.log('\n→ Deploying functions…')
  run('npx', ['firebase-tools', 'deploy', '--only', 'functions', '--project', staging, '--non-interactive', '--force'])
}

console.log('\n→ Deploying rules, indexes and storage…')
run('npx', ['firebase-tools', 'deploy', '--only', 'firestore:rules,firestore:indexes,storage', '--project', staging, '--non-interactive'])

console.log('\n→ Deploying hosting…')
run('npx', ['firebase-tools', 'deploy', '--only', 'hosting', '--project', staging, '--non-interactive'])

console.log(`\nStaging updated: https://${staging}.web.app\n`)
