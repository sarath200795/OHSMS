// ─────────────────────────────────────────────────────────────────────────────
// File storage — the seam between the app and whichever backend holds bytes.
//
// Callers deal in {url, path} and never see the backend. Which backend that is
// comes from VITE_STORAGE_DRIVER:
//
//   firebase  (default)  Firebase Storage           adapters/firebase.js
//   s3                   any S3-compatible bucket   adapters/s3.js
//
// Adding a backend = one adapter file implementing { put(path, blob) -> {url},
// remove(path) } plus a line in DRIVERS below. Nothing outside this folder
// changes — every module already calls putFile/removeFile only.
//
// putFile returns null on ANY failure — driver not configured, offline, rules
// refusal — so every caller can fall back to the old inline dataUrl and the
// app keeps working un-degraded while infrastructure catches up.
// ─────────────────────────────────────────────────────────────────────────────
import { reportError } from '../monitoring'

const DRIVER = String(import.meta.env.VITE_STORAGE_DRIVER || 'firebase')
  .trim()
  .toLowerCase()

// Dynamic imports so only the selected driver's code (and its SDK) is loaded.
const DRIVERS = {
  firebase: () => import('./adapters/firebase.js'),
  s3: () => import('./adapters/s3.js'),
}

let adapterPromise = null
function loadAdapter() {
  if (!adapterPromise) {
    const load = DRIVERS[DRIVER] || DRIVERS.firebase
    adapterPromise = load()
      .then((m) => m.default)
      .catch(() => null)
  }
  return adapterPromise
}

/** The active driver name — surfaced for diagnostics/admin screens. */
export const storageDriver = DRIVER in DRIVERS ? DRIVER : 'firebase'

// ── The two size limits, and why there are two ───────────────────────────────
//
// MAX_UPLOAD_BYTES is the real, user-facing limit: what a photo or document may
// be when it goes to the bucket. Storage does not care, so this is a product
// decision (bandwidth on site WiFi, and a cap so one upload cannot fill a
// screen's worth of time).
//
// MAX_INLINE_BYTES is the fallback limit. When the bucket is unavailable the
// app still accepts the file by writing it base64 INSIDE a Firestore document,
// and Firestore hard-caps a document at 1MB. Base64 inflates by ~33%, so 700KB
// of file is about as much as fits with room for the record's own fields.
//
// A file between the two is accepted when storage works and refused with a
// straight explanation when it does not — which is far better than writing a
// document that Firestore will reject with something unreadable.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const MAX_INLINE_BYTES = 700 * 1024

/** Human size, for messages people read. */
export const formatSize = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`

/**
 * The message shown when the bucket is unavailable and the file is too big to
 * keep inline. Central so every module says the same thing.
 */
export const tooLargeForInline = (name) =>
  `${name ? `${name}: ` : ''}file storage is unavailable, so files must be under ` +
  `${formatSize(MAX_INLINE_BYTES)}. Enable Cloud Storage to upload up to ${formatSize(MAX_UPLOAD_BYTES)}.`

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
 *
 * This layout is backend-neutral on purpose: on S3 the same `orgs/<orgId>/…`
 * prefix is what the presign endpoint authorises against.
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
    const adapter = await loadAdapter()
    if (!adapter) return null
    const blob = typeof file === 'string' ? dataUrlToBlob(file) : file
    if (!blob) return null
    const name = safeFileName(fileName || file?.name)
    const path = storagePath(orgId, kind, name)
    const result = await adapter.put(path, blob)
    if (!result?.url) return null
    return { url: result.url, path, size: blob.size, contentType: blob.type || '', name }
  } catch (e) {
    // Expected while the bucket/rules are not yet enabled in the console —
    // report once-per-kind noise is acceptable, silence is not.
    reportError(e, { source: 'storage.putFile', kind, driver: storageDriver })
    return null
  }
}

/** Delete by path. Best-effort: an orphaned file is a cost, not a correctness bug. */
export async function removeFile(path) {
  if (!path) return
  try {
    const adapter = await loadAdapter()
    if (!adapter) return
    await adapter.remove(path)
  } catch { /* orphan tolerated */ }
}
