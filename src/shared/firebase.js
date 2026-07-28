import { initializeApp } from 'firebase/app'
import {
  getAuth,
  connectAuthEmulator,
  setPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
} from 'firebase/auth'
import { initializeFirestore, connectFirestoreEmulator } from 'firebase/firestore'

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

const firebaseConfig = {
  apiKey: clean(import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: clean(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: clean(import.meta.env.VITE_FIREBASE_PROJECT_ID),
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

export const usingEmulators = USE_EMULATORS

if (!isFirebaseConfigured) {
  // eslint-disable-next-line no-console
  console.warn('[OHS MS] Firebase is not configured. Copy .env.example to .env.')
}

// Only initialize when configured — calling getAuth() with an undefined apiKey
// throws at module load and blanks the whole app (so SetupNeeded can't render).
const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null
export const auth = app ? getAuth(app) : null
// initializeFirestore (not getFirestore) so we can auto-detect networks that need
// long-polling (VPNs, restrictive proxies) and transparently fall back.
export const db = app
  ? initializeFirestore(app, { experimentalAutoDetectLongPolling: true })
  : null

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
