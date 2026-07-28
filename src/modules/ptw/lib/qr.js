// QR token generation + public URL building. The QR encodes a URL to the public
// /permit/:token page (which renders live details + countdown) rather than raw
// data, so codes stay scannable and always current.

/** Generate an unguessable, URL-safe token for a public permit QR page. */
export function generateQrToken() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 18)
}

/** Absolute, public URL the QR code points to. */
export function publicPermitUrl(token) {
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : ''
  return `${origin}/permit/${token}`
}
