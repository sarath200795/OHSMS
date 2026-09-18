// ─────────────────────────────────────────────────────────────────────────────
// Apply the organization's theme to the document.
//
// AuthProvider already holds the live org document, so this sits next to the
// rest of the tree and rewrites `--canvas` / `--brand-*` whenever that
// snapshot (or the resolved logo) changes. Login and the platform console
// have no org — the kit defaults in index.css stay.
//
// Persisted `org.theme` wins. Sampling the logo bitmap is only how a mark
// uploaded before this field existed still tints the chrome, and how a brand
// new upload previews before the snapshot round-trips.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useFileUrl } from '../storage/useFileUrl'
import { hasOrgLogo } from './OrgMark'
import {
  DEFAULT_ACCENT,
  DEFAULT_CANVAS,
  applyOrgTheme,
  extractPaletteFromSrc,
  readTheme,
  themeTokens,
} from './theme'

export default function OrgTheme() {
  const { org } = useAuth()
  const { src } = useFileUrl({ url: org?.logoUrl, path: org?.logoPath })
  const stored = readTheme(org?.theme)

  useEffect(() => {
    if (!org) {
      applyOrgTheme(null)
      return undefined
    }

    let cancelled = false
    const accentReady = stored.accent
    const canvasReady = stored.canvas
    const needsSample = hasOrgLogo(org) && src && (!accentReady || !canvasReady)

    const paint = (accent, canvas) => {
      if (cancelled) return
      // Kit defaults already live in :root. Rewriting them with a generated
      // scale from the same teal is how `.btn-soft` dropped to 4.46:1 — the
      // baked brand-700 is darker than mix(solid, black, 0.18).
      const a = accent || DEFAULT_ACCENT
      const c = canvas || DEFAULT_CANVAS
      if (a.toLowerCase() === DEFAULT_ACCENT && c.toLowerCase() === DEFAULT_CANVAS) {
        applyOrgTheme(null)
        return
      }
      applyOrgTheme(themeTokens({ accent: a, canvas: c }))
    }

    paint(accentReady || DEFAULT_ACCENT, canvasReady || DEFAULT_CANVAS)

    if (!needsSample)
      return () => {
        cancelled = true
      }

    extractPaletteFromSrc(src)
      .then((palette) => {
        if (cancelled) return
        paint(accentReady || palette.accent, canvasReady || palette.canvasWash)
      })
      .catch(() => {
        // CORS, a broken blob, a 1×1 pixel — keep whatever we already painted.
      })

    return () => {
      cancelled = true
    }
  }, [org, src, stored.accent, stored.canvas])

  return null
}
