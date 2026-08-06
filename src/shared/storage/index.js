// ─────────────────────────────────────────────────────────────────────────────
// File storage.
//
// Until now every uploaded file lived as a base64 string INSIDE a Firestore
// document, capped at ~750–900KB per file because documents top out at 1MB.
// That ceiling is the app's biggest structural risk: it is invisible until the
// day a write fails, and it bloats every read that touches a record with files.
//
// This module is the seam. Callers deal in {url, path} and never see the
// backend; today it is Firebase Storage, and pointing it at S3/GCS/MinIO later
// means reimplementing three functions in one file.
//
// putFile returns null on ANY failure — bucket not enabled in the console yet,
// offline, rules refusal — so every caller can fall back to the old inline
// dataUrl and the app keeps working un-degraded while infrastructure catches
// up. A cleanup that breaks uploads for a project that has not clicked "enable
// Storage" would be worse than the ceiling it fixes.
// ─────────────────────────────────────────────────────────────────────────────
import app, { firebaseClientConfig } from '../firebase'
import { reportError } from '../monitoring'

const USE_EMULATORS = String(import.meta.env.VITE_USE_EMULATORS).trim() === 'true'
const EMU_HOST = (import.meta.env.VITE_EMULATOR_HOST || '127.0.0.1').trim()
const EMU_STORAGE_PORT = Number(import.meta.env.VITE_EMULATOR_STORAGE_PORT) || 9199

let storagePromise = null
function loadStorage() {
  if (!app) return Promise.resolve(null)
  if (!storagePromise) {
    storagePromise = import('firebase/storage')
      .then((mod) => {
        const storage = mod.getStorage(app)
        if (USE_EMULATORS) mod.connectStorageEmulator(storage, EMU_HOST, EMU_STORAGE_PORT)
        return { mod, storage }
      })
      .catch(() => null)
  }
  return storagePromise
}

/**
 * A user-supplied filename made path-safe. An allowlist, not a blocklist:
 * anything outside letters, digits, dot, dash, underscore, parens and spaces
 * becomes an underscore — impossible to get wrong for characters nobody
 * thought of, including the invisible ones.
 */
export function safeFileName(name) {
  const s = String(name || 'file')
    .replace(/[^A-Za-z0-9._\-() ]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  // All-underscore results (e.g. from '???') carry no information — reset.
  return (/[A-Za-z0-9]/.test(s) ? s : 'file').slice(0, 120)
}

/**
 * Where a file lives: org-scoped so storage rules can enforce the same tenancy
 * Firestore rules do, with an entropy prefix so two "photo.jpg"s never collide.
 * `rand` is injectable for tests; production uses crypto randomness.
 */
export function storagePath(orgId, kind, fileName, rand = defaultRand) {
  if (!orgId || !kind) throw new Error('storagePath needs an orgId and a kind')
  // Every segment is sanitised, not only the filename. orgId is a Firestore
  // auto-id and kind a literal today, but a path builder that trusts its inputs
  // is one refactor away from a traversal — and the org segment is what the
  // storage rules match tenancy on, so nothing may be able to distort it.
  const seg = (v) => {
    const s = String(v).replace(/[^A-Za-z0-9_-]/g, '_')
    if (!/[A-Za-z0-9]/.test(s)) throw new Error('storagePath segment carries no information')
    return s
  }
  return `orgs/${seg(orgId)}/${seg(kind)}/${rand()}-${safeFileName(fileName)}`
}

function defaultRand() {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** A data: URL (the app's legacy file format) as a Blob, or null if malformed. */
export function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl || ''))
  if (!m) return null
  const type = m[1] || 'application/octet-stream'
  try {
    const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3])
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
    return new Blob([bytes], { type })
  } catch {
    return null
  }
}

/**
 * Upload a File/Blob (or legacy data: URL string) and return
 * `{ url, path, size, contentType, name }` — or null, meaning "store it the
 * old way instead".
 */
export async function putFile(orgId, kind, file, fileName) {
  try {
    const loaded = await loadStorage()
    if (!loaded) return null
    const blob = typeof file === 'string' ? dataUrlToBlob(file) : file
    if (!blob) return null
    const name = safeFileName(fileName || file?.name)
    const path = storagePath(orgId, kind, name)
    const ref = loaded.mod.ref(loaded.storage, path)
    await loaded.mod.uploadBytes(ref, blob, { contentType: blob.type || undefined })
    const url = await loaded.mod.getDownloadURL(ref)
    return { url, path, size: blob.size, contentType: blob.type || '', name }
  } catch (e) {
    // Expected while the bucket/rules are not yet enabled in the console —
    // report once-per-kind noise is acceptable, silence is not.
    reportError(e, { source: 'storage.putFile', kind })
    return null
  }
}

/** Delete by path. Best-effort: an orphaned file is a cost, not a correctness bug. */
export async function removeFile(path) {
  if (!path) return
  try {
    const loaded = await loadStorage()
    if (!loaded) return
    await loaded.mod.deleteObject(loaded.mod.ref(loaded.storage, path))
  } catch { /* orphan tolerated */ }
}

// A vestige of the config is exported so a future S3 adapter has what it needs
// to keep the same call sites. Nothing else reads it today.
export const storageBucketHint = firebaseClientConfig?.projectId
  ? `${firebaseClientConfig.projectId}.appspot.com`
  : ''
