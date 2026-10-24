// The Telegram bot username is already public (docs/WHATSAPP.md). It is a
// link, not a credential, and Org Settings does not manage Telegram beyond
// showing it. The WhatsApp click-to-chat URL is NOT a constant: it is built
// server-side from WA_DISPLAY_NUMBER and checked again here before it is
// turned into a link or a QR code.

export const TELEGRAM_SITE_LOOKUP_URL = 'https://t.me/WEEHS_Site_Lookup_bot'
export const TELEGRAM_SITE_LOOKUP_USERNAME = '@WEEHS_Site_Lookup_bot'

/** A wa.me URL for a real handset, or null. Anything else must not become a QR or an href. */
export function safeWaChatLink(url) {
  return typeof url === 'string' && /^https:\/\/wa\.me\/[1-9]\d{10,14}$/.test(url) ? url : null
}
