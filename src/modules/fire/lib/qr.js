// QR token generation + public URL building.
// The QR encodes a URL to the public /qr/:token page (which renders live, full
// details) rather than stuffing raw data into the code — keeps codes scannable
// and always current.

/** Generate an unguessable, URL-safe token for a public QR page. */
export function generateQrToken() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 18)
}

/** Absolute, public URL the QR code points to. */
export function publicQrUrl(token) {
  const origin =
    typeof window !== 'undefined' && window.location ? window.location.origin : ''
  return `${origin}/qr/${token}`
}

/**
 * Adopt a QR code an organization has already printed.
 *
 * Sites often arrive with labels already stuck on every extinguisher. Reprinting
 * hundreds of them is not realistic, so a bulk upload may carry the existing QR
 * value and we reuse its identifier rather than minting a new one — a scan of
 * the old label then resolves to this asset.
 *
 * Accepts a full URL ("https://.../qr/AB12CD") or a bare token, and returns the
 * token, or '' when the value cannot be used as one.
 */
export function tokenFromQrValue(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  // Take the last segment of the URL's PATH; a bare token is left alone.
  // Parsing properly matters: naively splitting on "/" leaves the host as the
  // last segment for a URL like "https://example.com/", which would then be
  // adopted as a token.
  let candidate = raw
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parts = new URL(raw).pathname.split('/').filter(Boolean)
      candidate = parts[parts.length - 1] || ''
    } catch {
      return ''
    }
  } else if (raw.includes('/')) {
    const parts = raw.split(/[?#]/)[0].split('/').filter(Boolean)
    candidate = parts[parts.length - 1] || ''
  }
  // Firestore document ids cannot contain / and must be non-empty; keep it
  // URL-safe so the token round-trips through publicQrUrl unchanged.
  if (!/^[A-Za-z0-9._~-]{4,128}$/.test(candidate)) return ''
  return candidate
}
