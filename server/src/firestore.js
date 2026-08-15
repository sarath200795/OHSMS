// ─────────────────────────────────────────────────────────────────────────────
// The Admin SDK handles, and the guard that keeps a test off production.
//
// READ THIS BEFORE USING getDb(). firebase-admin does not evaluate
// firestore.rules. Not a relaxed version of them — none of them. Every rule
// that protected an operation has to exist again, in JavaScript, before this
// handle serves that operation. A route that writes through here without the
// equivalent check is not a weaker rule, it is no rule: it is a hole straight
// through the entire security model, and firestore.rules cannot see it to
// backstop it.
//
// Initialisation is LAZY on purpose. Importing this module must not need
// credentials, or every unit test in the tree would need a service account to
// import a file that merely mentions Firestore.
// ─────────────────────────────────────────────────────────────────────────────
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

// The project the rules suite already uses (tests/*.rules.test.js). Matching it
// means one emulator serves both, so a route and the rule it reimplements can
// be pointed at the same data.
const EMULATOR_PROJECT_ID = 'ohsms-demo'

/**
 * The Admin SDK honours FIRESTORE_EMULATOR_HOST by itself; this only reports
 * whether it will, so the rest of the module can refuse to guess.
 */
export const isEmulated = () => Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const configuredProjectId = () =>
  process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || null

let app = null
let db = null

/**
 * The one firebase-admin app for this process.
 *
 * On Cloud Run `initializeApp()` with no argument is correct: it picks up the
 * service account and the project from the metadata server, so nothing about
 * production credentials is ever written down here or shipped in the image.
 */
export function getAdminApp() {
  if (app) return app

  // THE GUARD THAT MATTERS. A test run that reaches a real database writes to
  // a real tenant's records, and does it under the Admin SDK, which means no
  // rule refuses it. `vitest` sets NODE_ENV=test, so the only way a test talks
  // to Firestore at all is with the emulator host set — deliberately, by the
  // person running it.
  if (process.env.NODE_ENV === 'test' && !isEmulated()) {
    throw new Error(
      'Refusing to initialise firebase-admin in a test without FIRESTORE_EMULATOR_HOST. ' +
        'Start the Firestore emulator and export it, or stub this module.'
    )
  }

  // getApps() first: a second initializeApp in one process throws, and under a
  // watch-mode reload the module can be evaluated twice.
  app =
    getApps()[0] ||
    (isEmulated()
      ? initializeApp({ projectId: configuredProjectId() || EMULATOR_PROJECT_ID })
      : initializeApp())

  return app
}

/** The Firestore handle. Admin — it bypasses firestore.rules. See the header. */
export function getDb() {
  if (!db) db = getFirestore(getAdminApp())
  return db
}

/** The Auth handle, used to verify the caller's ID token. */
export function getAdminAuth() {
  return getAuth(getAdminApp())
}
