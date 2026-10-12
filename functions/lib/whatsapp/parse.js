// ─────────────────────────────────────────────────────────────────────────────
// What arrived, and what it asks for.
//
// extractMessages flattens a Cloud API webhook payload into the inbound
// messages this bot answers. Statuses (sent / delivered / read) are counted
// separately for cost monitoring and never answered. The sender's WhatsApp
// profile name rides in the same payload and is dropped here, on purpose: it is
// personal data the feature has no use for.
//
// parseCommand turns message text into one intent. The bot is a lookup, not a
// conversation: LINK <code>, UNLINK / STOP, HELP, or a site to look up.
// ─────────────────────────────────────────────────────────────────────────────

/** Digits only, as Meta's wa_id is. Not a validity check, just a shape. */
export function normaliseWaId(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length >= 8 && digits.length <= 15 ? digits : ''
}

/**
 * Inbound messages addressed to `phoneNumberId`.
 * Returns { messages: [{ wamid, from, timestamp, type, text, choiceId }], statuses: n }.
 * A change for another business number is ignored: one Meta app can carry
 * several, and only one of them is this bot.
 */
export function extractMessages(payload, phoneNumberId) {
  const messages = []
  let statuses = 0
  if (!payload || payload.object !== 'whatsapp_business_account') return { messages, statuses }
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field !== 'messages') continue
      const value = change.value || {}
      const to = String(value.metadata?.phone_number_id ?? '')
      if (!phoneNumberId || to !== String(phoneNumberId)) continue
      statuses += Array.isArray(value.statuses) ? value.statuses.length : 0
      for (const m of Array.isArray(value.messages) ? value.messages : []) {
        const from = normaliseWaId(m?.from)
        const wamid = typeof m?.id === 'string' ? m.id : ''
        if (!from || !wamid) continue
        let text = ''
        let choiceId = ''
        let location = null
        if (m.type === 'location') location = readLocation(m.location)
        else if (m.type === 'text') text = String(m.text?.body ?? '')
        else if (m.type === 'interactive') {
          const reply = m.interactive?.list_reply || m.interactive?.button_reply || {}
          choiceId = String(reply.id ?? '')
          text = String(reply.title ?? '')
        } else if (m.type === 'button') text = String(m.button?.text ?? '')
        messages.push({
          wamid,
          from,
          timestamp: Number(m.timestamp) || 0,
          type: m.type || '',
          text,
          choiceId,
          location,
        })
      }
    }
  }
  return { messages, statuses }
}

/**
 * A shared location as { latitude, longitude }, or null. Only the two numbers
 * are kept: the name and address Meta may attach are dropped, and the
 * coordinates themselves are used for one distance calculation and never
 * stored or logged (handler.js).
 */
export function readLocation(loc) {
  const lat = Number(loc?.latitude)
  const lng = Number(loc?.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  if (lat === 0 && lng === 0) return null
  return { latitude: lat, longitude: lng }
}

const GREETINGS = new Set([
  'hi',
  'hello',
  'hey',
  'hii',
  'namaste',
  'site',
  'details',
  'info',
  'please',
  'pls',
])

/** Lower-case, trimmed, single-spaced, without leading greetings/punctuation. */
export function cleanQuery(text) {
  const words = String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[!?,.;:"'`*_~]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  while (words.length && GREETINGS.has(words[0])) words.shift()
  return words.join(' ').slice(0, 120)
}

/**
 * One intent:
 *   { kind: 'link', code }    LINK 123456
 *   { kind: 'badLink' }       LINK followed by something that is not 6 digits
 *   { kind: 'unlink' }        UNLINK or STOP
 *   { kind: 'help' }          HELP / MENU / ?
 *   { kind: 'choice', siteId} a tap on a list row this bot sent
 *   { kind: 'location', latitude, longitude }  a shared location
 *   { kind: 'greeting' }      nothing left after the greeting
 *   { kind: 'site', query }   anything else
 */
export function parseCommand(message = {}) {
  const choice = /^site:([A-Za-z0-9_-]{1,128})$/.exec(String(message.choiceId ?? ''))
  if (choice) return { kind: 'choice', siteId: choice[1] }
  if (message.type === 'location') {
    const loc = message.location || readLocation(message)
    return loc ? { kind: 'location', ...loc } : { kind: 'badLocation' }
  }

  const raw = String(message.text ?? '').trim()
  const link = /^link\b\s*(.*)$/i.exec(raw)
  if (link) {
    const code = link[1].replace(/[\s-]/g, '')
    return /^\d{6}$/.test(code) ? { kind: 'link', code } : { kind: 'badLink' }
  }
  const q = cleanQuery(raw)
  if (q === 'unlink' || q === 'stop' || q === 'unsubscribe') return { kind: 'unlink' }
  if (q === 'help' || q === 'menu' || raw === '?') return { kind: 'help' }
  if (!q) return { kind: 'greeting' }
  return { kind: 'site', query: q }
}
