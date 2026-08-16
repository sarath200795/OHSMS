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
import { isSealedFile, openFileBytes, sealFileBytes } from '../crypto'

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
    // Base64 payloads are binary-safe (charCodeAt is always ≤ 255). Non-base64
    // payloads are decoded UTF-16 strings where charCodeAt can exceed 255,
    // truncating non-ASCII characters. Use TextEncoder for those.
    const bytes = m[2]
      ? Uint8Array.from(raw, (c) => c.charCodeAt(0))
      : new TextEncoder().encode(raw)
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
export async function putFile(orgId, kind, file, fileName, { collection } = {}) {
  try {
    const adapter = await loadAdapter()
    if (!adapter) return null
    const blob = typeof file === 'string' ? dataUrlToBlob(file) : file
    if (!blob) return null
    const name = safeFileName(fileName || file?.name)
    const path = storagePath(orgId, kind, name)

    // Sealing is opt-in per collection (shared/crypto/policy.js) and returns the
    // bytes untouched with meta:null for everything else, so the common path is
    // unchanged. `collection` is passed by the caller rather than derived from
    // `kind` because the two are different vocabularies: `kind` is a Storage
    // path segment ('medical-records') and the policy is keyed by the Firestore
    // collection the POINTER lives in ('injuries/records'). Guessing one from
    // the other is how a file ends up sealed under the wrong class.
    const { bytes, meta } = await sealFileBytes(orgId, collection, new Uint8Array(await blob.arrayBuffer()))
    // Uploaded as octet-stream when sealed, so nothing downstream — a browser,
    // a thumbnailer, a virus scanner — tries to interpret ciphertext as a PDF.
    // The real type stays on the pointer for the reader to rebuild the Blob.
    const upload = meta ? new Blob([bytes], { type: 'application/octet-stream' }) : blob

    const result = await adapter.put(path, upload)
    if (!result?.url) return null
    return {
      url: result.url,
      path,
      // The ORIGINAL size and type, not the ciphertext's. Every screen that
      // prints a file size means the file the person chose, and the reader
      // needs the real type to rebuild a Blob the browser will render.
      size: blob.size,
      contentType: blob.type || '',
      name,
      ...(meta || {}),
    }
  } catch (e) {
    // Expected while the bucket/rules are not yet enabled in the console —
    // report once-per-kind noise is acceptable, silence is not.
    reportError(e, { source: 'storage.putFile', kind, driver: storageDriver })
    return null
  }
}

/**
 * Delete by path. Best-effort: an orphaned file is a cost, not a correctness bug.
 *
 * On the Firebase driver this goes through the `deleteOrgFile` CALLABLE rather
 * than straight to the bucket, and `storage.rules` refuses client deletes
 * outright so there is no second route.
 *
 * The reason is SECURITY.md S-19. Storage rules can only read the caller's org
 * and role off their ID TOKEN — a Storage rule cannot query Firestore — and a
 * token stays valid for up to an hour. So a manager who had just been
 * suspended, demoted or moved to another tenant could still delete any file in
 * their old organization until it expired. Deleting is irreversible, the files
 * ARE the evidence, and nothing about it reaches the audit trail. The callable
 * reads the profile live on every request, so the database has the last word.
 *
 * Other drivers keep deleting directly: the callable is Firebase-specific, and
 * an S3-backed deployment has its own presign endpoint to authorise against.
 */
export async function removeFile(path) {
  if (!path) return
  try {
    if (storageDriver === 'firebase') {
      const { deleteOrgFile } = await import('../functions')
      await deleteOrgFile(path)
      return
    }
    const adapter = await loadAdapter()
    if (!adapter) return
    await adapter.remove(path)
  } catch { /* orphan tolerated */ }
}

/**
 * A URL for a stored file that storage.rules actually governs.
 *
 * Prefers an authenticated fetch by `path`. Falls back to the persisted `url`,
 * which is a permanent unauthenticated bearer link — so the fallback is the
 * insecure path, taken only when the secure one cannot work:
 *   - records written before uploads recorded a `path`
 *   - a driver with no `resolve` (inline/data-URL storage has nothing to fetch)
 *   - the bucket has no CORS rule for this origin yet
 *
 * Returns `{ url, revoke }`. Callers MUST call revoke() when done: an object
 * URL pins its blob in memory until it is released, and a gallery that forgets
 * leaks every photo the user scrolls past.
 */
export async function fileUrl(record, { orgId, collection } = {}) {
  const stored = typeof record === 'string' ? null : record?.url || null
  const path = typeof record === 'string' ? record : record?.path || null
  if (!path) return { url: stored, revoke: () => {} }

  // A sealed object takes a different route, and MUST NOT fall back to the
  // stored URL when anything goes wrong. That URL points at the ciphertext, so
  // the fallback would render a broken image and — worse — would look to a
  // manager exactly like a record whose file had gone missing, when in fact
  // they simply have no key loaded yet. Encrypted objects fail loudly by
  // returning no URL at all; the caller shows "restricted" rather than a
  // blank frame.
  if (isSealedFile(record)) {
    try {
      const adapter = await loadAdapter()
      const blob = adapter?.resolveBlob ? await adapter.resolveBlob(path) : null
      if (!blob) return { url: null, revoke: () => {}, restricted: true }
      const plain = await openFileBytes(orgId, collection, record, new Uint8Array(await blob.arrayBuffer()))
      // The real content type is on the POINTER, not on the object: the object
      // was uploaded as application/octet-stream so nothing tries to render
      // ciphertext as a PDF.
      const url = URL.createObjectURL(new Blob([plain], { type: record?.type || 'application/octet-stream' }))
      return { url, revoke: () => URL.revokeObjectURL(url) }
    } catch (e) {
      reportError(e, { source: 'storage.fileUrl.sealed', collection })
      return { url: null, revoke: () => {}, restricted: true }
    }
  }

  try {
    const adapter = await loadAdapter()
    const resolved = adapter?.resolve ? await adapter.resolve(path) : null
    if (resolved) return { url: resolved, revoke: () => URL.revokeObjectURL(resolved) }
  } catch { /* fall through to the stored URL */ }

  return { url: stored, revoke: () => {} }
}
