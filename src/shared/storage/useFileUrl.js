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
export function useFileUrl(record) {
  const stored = typeof record === 'string' ? null : record?.url || null
  const path = typeof record === 'string' ? record : record?.path || null
  const [url, setUrl] = useState(stored)

  useEffect(() => {
    setUrl(stored)
    if (!path) return undefined

    // Guarded because the record can change while a fetch is in flight —
    // without this, a slow resolve for the PREVIOUS photo wins the race and
    // shows the wrong image under the right caption.
    let live = true
    let release = () => {}
    fileUrl({ url: stored, path }).then((r) => {
      if (!live) { r.revoke(); return }
      release = r.revoke
      if (r.url) setUrl(r.url)
    })

    return () => { live = false; release() }
  }, [stored, path])

  return url
}
