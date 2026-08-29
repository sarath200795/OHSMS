import { initializeApp } from 'firebase/app'
import {
  getAuth,
  connectAuthEmulator,
  setPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
} from 'firebase/auth'
import {
  initializeFirestore,
  connectFirestoreEmulator,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

// Strip a leading UTF-8 BOM, zero-width chars, surrounding quotes and whitespace
// from an env value. Some build/deploy pipelines silently prepend a BOM, which
// corrupts every Firebase request and surfaces as auth/network-request-failed.
const clean = (v) =>
  // eslint-disable-next-line no-irregular-whitespace -- intentional: matches the exact zero-width/BOM chars to strip
  v == null ? '' : String(v).replace(/[​-‍﻿]/g, '').replace(/^["']|["']$/g, '').trim()

const USE_EMULATORS = clean(import.meta.env.VITE_USE_EMULATORS) === 'true'
const EMU_HOST = clean(import.meta.env.VITE_EMULATOR_HOST) || '127.0.0.1'
const EMU_AUTH_PORT = Number(clean(import.meta.env.VITE_EMULATOR_AUTH_PORT)) || 9099
const EMU_FS_PORT = Number(clean(import.meta.env.VITE_EMULATOR_FIRESTORE_PORT)) || 8080
const EMU_FN_PORT = Number(clean(import.meta.env.VITE_EMULATOR_FUNCTIONS_PORT)) || 5001

/**
 * Where the Functions emulator is, or null when we are not using emulators.
 *
 * Exported rather than wired up below, because firebase/functions is loaded
 * LAZILY — shared/functions.js imports it on the first callable, so that its
 * SDK stays out of every bundle that never calls one. The connection therefore
 * has to be made there, and this is the one place that knows the address.
 *
 * Without it, every callable in local development went to the deployed
 * production functions rather than the ones running on this machine: the
 * emulator suite would start, register the functions, log nothing, and the app
 * would report a bare "internal" error. Which is exactly what it did.
 */
export const emulatorFunctions = USE_EMULATORS ? { host: EMU_HOST, port: EMU_FN_PORT } : null

const projectId = clean(import.meta.env.VITE_FIREBASE_PROJECT_ID)

// Which Firestore database inside the project to talk to. Empty means the
// project's `(default)`, which is what every normal deployment uses.
//
// This exists because of what a restore drill found. Firestore CANNOT restore
// a backup over an existing database — a restore only ever lands in a NEW one,
// named at restore time. So on the day a backup is actually needed, the
// recovered data sits in `restored-2026-08-16` while the app is hardwired to
// `(default)`, and getting the two to meet required a code change and a
// redeploy. That is recovery time spent editing source under pressure, which
// is the worst possible moment to do it.
//
// With this, recovery is: restore → set this variable → rebuild → deploy.
// See PRODUCTION.md §3a.
const DATABASE_ID = clean(import.meta.env.VITE_FIREBASE_DATABASE_ID)

const firebaseConfig = {
  apiKey: clean(import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: clean(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId,
  // Without this, getStorage() cannot find a default bucket and every upload
  // silently falls back to inline data URLs. New Firebase projects (late 2024+)
  // create `<id>.firebasestorage.app`; older ones use `<id>.appspot.com` — the
  // env override exists because the default cannot know which vintage yours is.
  // Copy the exact value from console → Storage if the derived one is wrong.
  storageBucket:
    clean(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET) ||
    (projectId ? `${projectId}.firebasestorage.app` : ''),
  messagingSenderId: clean(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
  appId: clean(import.meta.env.VITE_FIREBASE_APP_ID),
}

// With emulators we only need a projectId; against a real project we also need an
// apiKey. This lets the emulator flow work with the demo config out of the box.
export const isFirebaseConfigured = USE_EMULATORS
  ? Boolean(firebaseConfig.projectId)
  : Boolean(firebaseConfig.apiKey && firebaseConfig.projectId)

// Exposed for secondary app instances (employee provisioning creates auth users
// on a throwaway app so the admin's own session is never replaced).
export const firebaseClientConfig = firebaseConfig
export const emulatorAuthUrl = USE_EMULATORS ? `http://${EMU_HOST}:${EMU_AUTH_PORT}` : null

if (!isFirebaseConfigured) {
  // eslint-disable-next-line no-console
  console.warn('[OHS MS] Firebase is not configured. Copy .env.example to .env.')
}

// Vite loads .env for EVERY mode, and .env.<mode> overrides only the keys it
// names. So any key a production env file forgets silently inherits the demo
// value — which is exactly how a build shipped pointing storage at the emulator
// bucket while auth and Firestore were correct, and every upload failed with
// nothing in the UI to explain it.
//
// A real deployment can never legitimately carry a demo value, so say so loudly
// rather than letting one subsystem quietly talk to the wrong project.
if (isFirebaseConfigured && !USE_EMULATORS) {
  const leaked = Object.entries(firebaseConfig)
    .filter(([, v]) => /ohsms-demo|demo-api-key|^0+$|:0+:/.test(String(v)))
    .map(([k]) => k)
  if (leaked.length) {
    // eslint-disable-next-line no-console
    console.error(
      `[OHS MS] Demo config leaked into a production build: ${leaked.join(', ')}. ` +
      'Define these keys explicitly in .env.production — inheriting them from .env ' +
      'points that subsystem at the wrong project.'
    )
  }
}

// Only initialize when configured — calling getAuth() with an undefined apiKey
// throws at module load and blanks the whole app (so SetupNeeded can't render).
const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null

// ── App Check ─────────────────────────────────────────────────────────────────
// The app has three deliberately-public write surfaces (equipment defect
// reports, defect locks, permit observations). App Check is what stops them
// being scripted: without a valid attestation token, requests are refused at
// Google's edge before any rule runs.
//
// Gated on the env key so local/emulator development is unaffected. Wiring the
// client is half the job — the other half is console-side and cannot live in
// this repo: register the site key, then turn ON enforcement for Firestore
// (docs/PRODUCTION.md walks through it). Until enforcement is on, this ships
// tokens but blocks nothing.
//
// The provider MUST match the attestation provider the app is registered with
// under App Check → Apps: the two mint different tokens and App Check refuses
// the wrong kind, which is why verified requests sat at 0%.
//
// This is ReCaptchaV3Provider because VITE_APPCHECK_SITE_KEY is a CLASSIC v3
// key. That is measured, not assumed. With this provider the page loads
// recaptcha/api.js, grecaptcha initialises and the badge renders; switching to
// ReCaptchaEnterpriseProvider made it load recaptcha/enterprise.js instead,
// which answered HTTP 400 and raised appCheck/recaptcha-error on every refresh.
//
// Note what that does NOT prove. api.js loading and the badge rendering only
// say the provider matches the key; they say nothing about whether reCAPTCHA
// will mint a token for THIS host. A site key is scoped to a list of domains,
// so a correct provider on a correct key still raises appCheck/recaptcha-error
// from any hostname the key does not list — which is what production did the
// day it moved from weehs-4eb28.web.app to suite.weehs.org. Check the Domains
// list before touching this line.
//
// The console registration currently SAYS reCAPTCHA Enterprise, and that label
// is the half that is wrong — fixing it is a console change, not a code one.
// Do not "correct" this line to match the label without first checking which
// script the browser actually loads and whether it 400s. Trusting the label
// over the key is exactly the mistake that produced those errors.
const APPCHECK_KEY = clean(import.meta.env.VITE_APPCHECK_SITE_KEY)
if (app && APPCHECK_KEY && !USE_EMULATORS) {
  // Dynamic so the App Check SDK costs nothing until a key is configured.
  import('firebase/app-check')
    .then(({ initializeAppCheck, ReCaptchaV3Provider, getToken }) => {
      const debug = clean(import.meta.env.VITE_APPCHECK_DEBUG_TOKEN)
      // The documented escape hatch for local dev against a real project.
      if (debug) self.FIREBASE_APPCHECK_DEBUG_TOKEN = debug
      const appCheck = initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(APPCHECK_KEY),
        isTokenAutoRefreshEnabled: true,
      })
      // initializeAppCheck is synchronous and does not throw when reCAPTCHA
      // refuses the key, so the .catch below never fires for the most common
      // App Check failure there is. What surfaces instead is a bare
      // `appCheck/recaptcha-error`, repeated on every refresh, naming neither
      // the host nor the cause — which is why diagnosing it meant probing
      // reCAPTCHA by hand from a checkout.
      //
      // Ask for one token up front purely so the cause gets named once, in the
      // console, beside the host that failed. The likeliest cause by a wide
      // margin is this host missing from the Domains list on the reCAPTCHA site
      // key: that list is per-hostname, so the day production moves to a new
      // domain every token starts failing while every symptom that would
      // implicate the key or the provider stays green — api.js still loads,
      // grecaptcha still initialises, the badge still renders.
      return getToken(appCheck).catch((e) => {
        // eslint-disable-next-line no-console
        console.error(
          `[OHS MS] App Check could not mint a token for ${self.location?.origin}: ` +
          `${e?.code || e?.message || e}. Most likely this host is missing from the ` +
          'Domains list on the reCAPTCHA site key — add it in the reCAPTCHA admin ' +
          'console (docs/PRODUCTION.md §1). While App Check is unenforced this blocks ' +
          'nothing, but verified requests stay at 0%, so it can never be enforced and ' +
          'the public write surfaces stay unprotected.'
        )
      })
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[OHS MS] App Check init failed:', e?.message || e)
    })
}
export const auth = app ? getAuth(app) : null
// initializeFirestore (not getFirestore) so we can auto-detect networks that need
// long-polling (VPNs, restrictive proxies) and transparently fall back.
//
// Persistent cache because this app is used standing in front of equipment on
// site WiFi: with it, a page that loaded once keeps answering from IndexedDB
// through dead spots, and writes queue until the network returns instead of
// failing. Multi-tab manager so a second open tab shares the cache rather than
// throwing the "already enabled elsewhere" error persistence is infamous for.
// If the browser refuses IndexedDB entirely (private mode, ancient WebView),
// fall back to memory-only — a working app beats a cached one.
// OFF by default, opt in with VITE_OFFLINE_CACHE=true.
//
// It was on by default for one release and that was the wrong call for a live
// app. A persistent cache changes the failure mode of a listener that never
// connects: instead of an error, the app serves an EMPTY cached snapshot and
// every list renders blank — which reads as "all our data is gone" rather than
// "we are offline". Losing offline tolerance is an inconvenience; a screen that
// silently claims a site has no equipment is not.
//
// Re-enable per environment once a bad-network session has been watched end to
// end and confirmed to show stale-but-real data rather than nothing.
const OFFLINE_CACHE = clean(import.meta.env.VITE_OFFLINE_CACHE) === 'true'

// initializeFirestore's third argument is the database id, and it is OPTIONAL —
// passing undefined is not the same as passing '(default)' in every SDK path,
// so omit the argument entirely unless a database was actually named.
const start = (settings) =>
  DATABASE_ID ? initializeFirestore(app, settings, DATABASE_ID) : initializeFirestore(app, settings)

function buildDb() {
  if (!app) return null
  const base = { experimentalAutoDetectLongPolling: true }
  if (!OFFLINE_CACHE) return start(base)
  try {
    return start({
      ...base,
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[OHS MS] persistent cache unavailable, running memory-only:', e?.message || e)
    return start(base)
  }
}
export const db = buildDb()

// Say it loudly. A build pointed at a non-default database is a RECOVERY state:
// either a drill or the aftermath of a restore. It is not a configuration
// anyone should discover months later while wondering why writes are missing
// from the database they were watching. Silence here would let a recovery build
// become the permanent deployment by accident.
if (DATABASE_ID) {
  // eslint-disable-next-line no-console
  console.warn(
    `[OHS MS] Firestore is pointed at the non-default database "${DATABASE_ID}". ` +
    'This is a recovery/drill configuration — unset VITE_FIREBASE_DATABASE_ID to ' +
    'return to (default).'
  )
}

if (app && USE_EMULATORS) {
  try {
    connectAuthEmulator(auth, `http://${EMU_HOST}:${EMU_AUTH_PORT}`, { disableWarnings: true })
    connectFirestoreEmulator(db, EMU_HOST, EMU_FS_PORT)
    // eslint-disable-next-line no-console
    console.info('[OHS MS] Connected to Firebase emulators at', EMU_HOST)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[OHS MS] Failed to connect emulators:', e?.message || e)
  }
}

if (auth && !USE_EMULATORS) {
  // Session persistence (login drops when tab/browser closes); fall back to
  // in-memory if the browser blocks site storage.
  setPersistence(auth, browserSessionPersistence).catch(() =>
    setPersistence(auth, inMemoryPersistence).catch(() => {})
  )
}

export default app
