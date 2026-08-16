import { useEffect, useState } from 'react'
import { fileUrl } from './index'

/**
 * Resolve a stored file to a URL that storage.rules governs, and release it.
 *
 * The release is the reason this is a hook rather than a call. fileUrl may hand
 * back an object URL, which pins its blob in memory until revoked — so every
 * consumer would otherwise have to remember an effect cleanup, and a gallery
 * that forgets leaks every photo the user scrolls past.
 *
 * Returns the stored URL immediately as `url` so nothing renders blank while
 * the authenticated fetch is in flight, then swaps to the resolved one.
 */
export function useFileUrl(record, { orgId, collection } = {}) {
  const stored = typeof record === 'string' ? null : record?.url || null
  const path = typeof record === 'string' ? record : record?.path || null
  // An encrypted object has no usable stored URL — it points at ciphertext —
  // so the optimistic first paint has to be skipped for those. Showing it would
  // render a broken image for the moment before the real one arrives, and
  // permanently for a reader who has no key.
  const sealed = Boolean(record?.encIv && record?.encKeyId)
  const [url, setUrl] = useState(sealed ? null : stored)

  useEffect(() => {
    setUrl(sealed ? null : stored)
    if (!path) return undefined

    // Guarded because the record can change while a fetch is in flight —
    // without this, a slow resolve for the PREVIOUS photo wins the race and
    // shows the wrong image under the right caption.
    let live = true
    let release = () => {}
    // The whole record goes through, not just {url, path}: the encryption
    // metadata rides on it, and fileUrl needs the content type to rebuild a
    // Blob the browser will actually render.
    fileUrl(sealed ? record : { url: stored, path }, { orgId, collection }).then((r) => {
      if (!live) { r.revoke(); return }
      release = r.revoke
      if (r.url) setUrl(r.url)
    })

    return () => { live = false; release() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, path, sealed, orgId, collection, record?.encIv])

  return url
}
