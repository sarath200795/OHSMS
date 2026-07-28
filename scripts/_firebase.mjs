// ─────────────────────────────────────────────────────────────────────────────
// Shared Firebase connection for the seed / maintenance scripts.
//
// Targets the EMULATORS by default. To run against a real project, set the same
// VITE_* variables the app uses (or export them from your .env.production):
//
//   VITE_USE_EMULATORS=false \
//   VITE_FIREBASE_API_KEY=… VITE_FIREBASE_PROJECT_ID=… VITE_FIREBASE_AUTH_DOMAIN=… \
//   SEED_ADMIN_EMAIL=admin@yourco.com SEED_ADMIN_PASSWORD=…  node scripts/seed-erp-baseline.mjs
//
// Running against production is guarded: pass --prod (or SEED_CONFIRM_PROD=yes)
// so nobody points a demo seed at live data by accident.
// ─────────────────────────────────────────────────────────────────────────────
import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'

const env = process.env
const useEmulators = (env.VITE_USE_EMULATORS ?? 'true') !== 'false'

const HOST = env.VITE_EMULATOR_HOST || '127.0.0.1'
const AUTH_PORT = Number(env.VITE_EMULATOR_AUTH_PORT) || 9099
const FS_PORT = Number(env.VITE_EMULATOR_FIRESTORE_PORT) || 8080

export const ADMIN_EMAIL = env.SEED_ADMIN_EMAIL || 'admin@acme.test'
export const ADMIN_PASSWORD = env.SEED_ADMIN_PASSWORD || 'password123'

/**
 * Connect and sign in as the admin. Returns { app, auth, db, orgId, uid, profile }.
 * `orgId` is read from the signed-in user's profile, so scripts never hardcode it.
 */
export async function connect({ requireAdmin = true } = {}) {
  if (!useEmulators) {
    const confirmed = process.argv.includes('--prod') || env.SEED_CONFIRM_PROD === 'yes'
    if (!confirmed) {
      console.error(
        '\nRefusing to run against a REAL Firebase project without confirmation.\n' +
        `Project: ${env.VITE_FIREBASE_PROJECT_ID || '(unset)'}\n` +
        'Re-run with --prod (or SEED_CONFIRM_PROD=yes) if that is intended.\n'
      )
      process.exit(1)
    }
    if (!env.VITE_FIREBASE_API_KEY || !env.VITE_FIREBASE_PROJECT_ID) {
      console.error('VITE_FIREBASE_API_KEY and VITE_FIREBASE_PROJECT_ID must be set for a real project.')
      process.exit(1)
    }
  }

  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY || 'demo-api-key',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'ohsms-demo.firebaseapp.com',
    projectId: env.VITE_FIREBASE_PROJECT_ID || 'ohsms-demo',
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'ohsms-demo.appspot.com',
  })
  const auth = getAuth(app)
  const db = getFirestore(app)

  if (useEmulators) {
    connectAuthEmulator(auth, `http://${HOST}:${AUTH_PORT}`, { disableWarnings: true })
    connectFirestoreEmulator(db, HOST, FS_PORT)
  }

  const cred = await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD)
  const { doc, getDoc } = await import('firebase/firestore')
  const snap = await getDoc(doc(db, 'users', cred.user.uid))
  const profile = snap.exists() ? snap.data() : null

  if (requireAdmin && !profile?.orgId) {
    console.error(`Signed in as ${ADMIN_EMAIL} but no /users profile with an orgId was found.`)
    process.exit(1)
  }

  console.log(`→ ${useEmulators ? 'EMULATORS' : `PROJECT ${env.VITE_FIREBASE_PROJECT_ID}`} as ${ADMIN_EMAIL} (org ${profile?.orgId})`)
  return { app, auth, db, uid: cred.user.uid, orgId: profile?.orgId, profile }
}

export const targetIsEmulator = useEmulators
