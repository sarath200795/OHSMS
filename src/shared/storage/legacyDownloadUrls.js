// ─────────────────────────────────────────────────────────────────────────────
// Inventory of legacy permanent download URLs, and which of them are safe to
// revoke.
//
// #49 stopped minting new ones (adapters/firebase.js no longer calls
// getDownloadURL). Every URL minted before that change still works: it is a
// bearer credential in a query string (`token=`), it answers to no rule, and it
// keeps working after the holder leaves the organisation.
//
// Revoking one means stripping `firebaseStorageDownloadTokens` from the Storage
// object. Doing that BLIND permanently breaks any pointer that has a url and
// no `path` — fileUrl falls back to the stored url when there is no path, so
// killing the token leaves a record that cannot be opened any other way.
// Records from before uploads recorded a path look exactly like that.
//
// This module does not talk to Firestore or Storage. It classifies pointers
// and plans a revoke. The script (scripts/inventory-download-tokens.mjs) walks
// the tenant and, only with --apply AND Admin credentials, strips tokens for
// the revoke list. Dry-run is the default. Review items are never in that list.
// ─────────────────────────────────────────────────────────────────────────────

export const REVOKE = 'revoke'
export const REVIEW = 'review'
export const SKIP = 'skip'

/** A Firebase download URL carries the token as `?token=` or `&token=`. */
const TOKEN_QUERY = /[?&]token=([0-9a-f-]{8,})/i

/** Hosts that actually serve the firebaseStorageDownloadTokens credential. */
const DOWNLOAD_HOST = /firebasestorage\.googleapis\.com/i

const URL_KEYS = ['url', 'fileUrl', 'logoUrl']
const PATH_KEYS = ['path', 'filePath', 'logoPath']

const norm = (v) => String(v ?? '').trim()

export function isDataUrl(value) {
  return /^data:/i.test(norm(value))
}

export function tokenFromUrl(url) {
  const s = norm(url)
  if (!s || isDataUrl(s) || !DOWNLOAD_HOST.test(s)) return ''
  const m = s.match(TOKEN_QUERY)
  return m ? m[1] : ''
}

/**
 * The object path encoded in a getDownloadURL, if the URL is one of ours.
 *
 * Reported on review rows as a HINT for a human who may want to backfill
 * `path` before a later revoke. Never used as a substitute for a stored path:
 * recovering it and then stripping the token is the blind revoke this module
 * exists to refuse.
 */
export function pathFromDownloadUrl(url) {
  const s = norm(url)
  if (!DOWNLOAD_HOST.test(s)) return ''
  try {
    const u = new URL(s)
    const marker = '/o/'
    const i = u.pathname.indexOf(marker)
    if (i < 0) return ''
    const encoded = u.pathname.slice(i + marker.length)
    if (!encoded) return ''
    return decodeURIComponent(encoded)
  } catch {
    return ''
  }
}

export function urlFromPointer(obj) {
  if (obj == null || typeof obj !== 'object') return ''
  for (const k of URL_KEYS) {
    const v = norm(obj[k])
    if (v) return v
  }
  return ''
}

export function pathFromPointer(obj) {
  if (obj == null || typeof obj !== 'object') return ''
  for (const k of PATH_KEYS) {
    const v = norm(obj[k])
    if (v) return v
  }
  return ''
}

/**
 * Classify one pointer.
 *
 *   revoke  — has a download token AND a stored path. fileUrl can getBlob.
 *   review  — has a download token and NO stored path. Must not be revoked.
 *   skip    — inline data:, no token, empty, or not a Firebase download URL.
 */
export function classifyPointer(obj, loc = '') {
  const url = urlFromPointer(obj)
  const path = pathFromPointer(obj)
  const token = tokenFromUrl(url)

  if (isDataUrl(url)) {
    return { action: SKIP, reason: 'inline', loc }
  }
  if (!token) {
    return { action: SKIP, reason: path ? 'path-only' : 'no-token', loc, path: path || undefined }
  }
  if (path) {
    return { action: REVOKE, loc, path, token }
  }
  return {
    action: REVIEW,
    reason: 'url-only',
    loc,
    token,
    // Hint only. applyTargets ignores this field.
    suggestedPath: pathFromDownloadUrl(url) || undefined,
  }
}

/**
 * Walk a document (and one-level-nested objects / arrays) for file pointers.
 *
 * Depth-capped so a sealed field of ciphertext is not treated as a tree, and
 * `dataUrl` values that are inline base64 are not descended into.
 */
export function classifyDoc(doc, { collection = '', id = '' } = {}, { maxDepth = 5 } = {}) {
  const found = []
  const root = collection && id ? `${collection}/${id}` : collection || id || '(doc)'

  const walk = (value, loc, depth) => {
    if (value == null || depth > maxDepth) return
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${loc}[${i}]`, depth + 1))
      return
    }
    if (typeof value !== 'object') return

    const url = urlFromPointer(value)
    const path = pathFromPointer(value)
    if (url || path) found.push(classifyPointer(value, loc))

    for (const [k, v] of Object.entries(value)) {
      if (URL_KEYS.includes(k) || PATH_KEYS.includes(k)) continue
      if (k === 'dataUrl' && isDataUrl(v)) continue
      walk(v, `${loc}.${k}`, depth + 1)
    }
  }

  walk(doc, root, 0)
  return found
}

export function planRevoke(rows = []) {
  const revoke = []
  const review = []
  const skipped = []
  for (const row of rows) {
    if (row?.action === REVOKE) revoke.push(row)
    else if (row?.action === REVIEW) review.push(row)
    else skipped.push(row)
  }
  return { revoke, review, skipped }
}

/**
 * The only list --apply may send to Storage.
 *
 * Filtered again here so a caller who concatenates `review` onto `revoke`, or
 * who passes the raw classifyDoc output, still cannot strip a url-only token.
 * The test that pins this is the one that would fail if that filter moved.
 */
export function applyTargets(plan) {
  return (plan?.revoke || []).filter((row) => row?.action === REVOKE && norm(row.path))
}

/**
 * Run the destructive half, or refuse to.
 *
 * `stripToken(path)` is injected so the safety filter is testable without a
 * bucket. The script supplies the Admin SDK implementation. Review rows never
 * reach it.
 */
export async function runRevoke(plan, { apply = false, stripToken } = {}) {
  const targets = applyTargets(plan)
  if (!apply) {
    return {
      dryRun: true,
      revoked: 0,
      wouldRevoke: targets.length,
      review: plan.review?.length || 0,
    }
  }
  if (typeof stripToken !== 'function') {
    throw new Error('Refusing --apply without a stripToken implementation (Admin SDK).')
  }
  let revoked = 0
  const failed = []
  for (const row of targets) {
    try {
      await stripToken(row.path)
      revoked += 1
    } catch (err) {
      failed.push({ path: row.path, loc: row.loc, error: err?.message || String(err) })
    }
  }
  return {
    dryRun: false,
    revoked,
    wouldRevoke: targets.length,
    failed,
    review: plan.review?.length || 0,
  }
}

/**
 * Subcollections that hold file pointers but are not listed as their own org
 * collection. The inventory script walks these after listing each parent.
 *
 * A pointer living somewhere this table does not name is still found if the
 * parent document itself carries url/path (extinguisher quotation, org logo).
 */
export const POINTER_SUBCOLLECTIONS = [
  { parent: 'incidents', sub: 'photos' },
  { parent: 'injuries', sub: 'records' },
  { parent: 'illnesses', sub: 'files' },
  { parent: 'mockDrills', sub: 'photos' },
  { parent: 'permits', sub: 'documents' },
]
