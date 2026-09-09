// ─────────────────────────────────────────────────────────────────────────────
// One stored file, resolved into something an <img src> can use.
//
// `resolveFiles.js` does this for LISTS, at the data seam, so that galleries and
// the printed PDFs needed no changes. This is the other shape: a single pointer
// rendered directly by a component — a course thumbnail, an organisation logo,
// an inspection's photo evidence, a LOTO isolation point.
//
// ── Why those sites had to change at all ────────────────────────────────────
//
// They rendered `<img src={record.url}>`, and `record.url` was a Firebase
// download URL: a permanent bearer credential in a string, which works for
// anyone holding it, signed in or not, forever, with no rule ever consulted.
// The read path for sealed files moved off those long ago; the WRITE path went
// on manufacturing one for every upload and filing it in a document readable by
// every member of the tenant and by the external auditor (audit finding M-5,
// A.8.3 / A.5.14).
//
// `adapters/firebase.js` no longer mints one. That closes the creation of new
// credentials and breaks exactly these renderers, because the field they read
// is now empty — hence this hook, which asks `fileUrl()` for an authenticated
// fetch by `path` instead.
//
// ── What it does NOT do ─────────────────────────────────────────────────────
//
// It does not stop working for records written before this change. `fileUrl`
// falls back to the stored url when there is no path, or when the fetch fails
// (a bucket with no CORS rule for this origin, an object that has gone). Old
// records keep rendering exactly as they did; only new ones take the new route.
// Revoking the tokens already written down is a separate, deliberate operation
// — see `revokeDownloadTokens` in functions/index.js, which is why it defaults
// to reporting rather than revoking.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { fileUrl } from './index'

/**
 * @param pointer   `{ url, path }`, or a bare path string, or a data: URL
 * @param options   `{ orgId, collection }` — required only for SEALED
 *                  collections, where the bytes have to be decrypted
 * @returns `{ src, loading, restricted }`
 *
 * `restricted` means the object exists and this reader may not have it — a
 * sealed file with no key loaded. It is deliberately distinct from `src: ''`,
 * because "we cannot show you this" and "there is nothing here" are different
 * things to put in front of somebody, and conflating them is how a missing
 * medical record and an unreadable one came to look identical.
 */
export function useFileUrl(pointer, { orgId, collection } = {}) {
  const [state, setState] = useState({ src: '', loading: false, restricted: false })

  // The identity of a pointer, for the dependency array. An object literal
  // rebuilt on every render would re-fetch on every render — and each fetch
  // mints a blob URL, so that is a leak as well as a waste.
  const path = typeof pointer === 'string' ? pointer : pointer?.path || ''
  const stored = typeof pointer === 'string' ? '' : pointer?.url || pointer?.dataUrl || ''

  useEffect(() => {
    // Nothing to resolve. A data: URL is already the bytes and never had a
    // path — the inline fallback taken when the bucket was unavailable.
    if (!path) {
      setState({ src: stored, loading: false, restricted: false })
      return undefined
    }

    let live = true
    let release = () => {}
    setState((s) => ({ ...s, loading: true }))

    fileUrl(typeof pointer === 'string' ? pointer : { ...pointer }, { orgId, collection })
      .then(({ url, revoke, restricted }) => {
        release = revoke || (() => {})
        // Resolved after the component went away, or after the pointer changed:
        // release immediately rather than setting state on a dead component.
        // Without this an object URL created by a superseded fetch is pinned in
        // memory with nothing left holding a reference to revoke it.
        if (!live) { release(); return }
        setState({ src: url || '', loading: false, restricted: Boolean(restricted) })
      })
      .catch(() => {
        if (live) setState({ src: stored, loading: false, restricted: false })
      })

    return () => { live = false; release() }
    // `pointer` itself is deliberately absent: callers pass object literals, and
    // depending on one would re-run this every render. path + stored are the
    // only parts that change what gets fetched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, stored, orgId, collection])

  return state
}

export default useFileUrl
