// The WhatsApp click-to-chat URL is NOT a constant: it is built server-side
// from WA_DISPLAY_NUMBER and checked again here before it is turned into a
// link or a QR code.

/** A wa.me URL for a real handset, or null. Anything else must not become a QR or an href. */
export function safeWaChatLink(url) {
  return typeof url === 'string' && /^https:\/\/wa\.me\/[1-9]\d{10,14}$/.test(url) ? url : null
}
