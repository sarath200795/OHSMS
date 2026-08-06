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

const projectId = clean(import.meta.env.VITE_FIREBASE_PROJECT_ID)

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
const APPCHECK_KEY = clean(import.meta.env.VITE_APPCHECK_SITE_KEY)
if (app && APPCHECK_KEY && !USE_EMULATORS) {
  // Dynamic so the App Check SDK costs nothing until a key is configured.
  import('firebase/app-check')
    .then(({ initializeAppCheck, ReCaptchaV3Provider }) => {
      const debug = clean(import.meta.env.VITE_APPCHECK_DEBUG_TOKEN)
      // The documented escape hatch for local dev against a real project.
      if (debug) self.FIREBASE_APPCHECK_DEBUG_TOKEN = debug
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(APPCHECK_KEY),
        isTokenAutoRefreshEnabled: true,
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
function buildDb() {
  if (!app) return null
  try {
    return initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[OHS MS] persistent cache unavailable, running memory-only:', e?.message || e)
    return initializeFirestore(app, { experimentalAutoDetectLongPolling: true })
  }
}
export const db = buildDb()

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
