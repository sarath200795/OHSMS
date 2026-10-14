// ─────────────────────────────────────────────────────────────────────────────
// Telegram site lookup: the same lookup as WhatsApp (../whatsapp/handler.js
// answerQuery), reached through a Telegram bot webhook.
//
// ACCESS: WhatsApp answers only numbers linked to an approved app user.
// Telegram gives a bot no phone number, so there is nothing to match against
// /users. By the owner's decision this channel is OPEN: anyone who messages
// the bot can look up the sites of ONE configured organisation (TG_ORG_ID, or
// the only organisation when there is exactly one), with exactly the reply
// WhatsApp would give an admin of that org — site summary counts and the
// site's emergency contacts. Nothing else is reachable. Rate limits, the
// global daily cap and the query log (no message text, chat id hashed) apply
// as for WhatsApp. TG_ENABLED=false switches it off.
// ─────────────────────────────────────────────────────────────────────────────
import { parseCommand, readLocation } from '../whatsapp/parse.js'
import { answerQuery, MAX_MESSAGE_AGE_MS } from '../whatsapp/handler.js'
import { countQuery } from '../whatsapp/rateLimit.js'
import { safeEqual, isRealSecret } from '../whatsapp/signature.js'

export const TG_MAX_TEXT = 4096
export const TG_API = 'https://api.telegram.org'

export const TG_HELP =
  'WeEHS site lookup.\n\n' +
  'Send a site code (e.g. BLR0123) or part of a site name to get its safety summary: ' +
  'extinguishers (HPT due / empty), open defects, first aid boxes, pending actions, ' +
  'incidents and emergency contacts.\n\n' +
  "Can't remember the name? Share your location (📎 → Location) for the nearest sites.\n\n" +
  'In an emergency call 112.'

/** The secret_token header Telegram sends, checked in constant time. */
export function verifySecretToken(header, secret) {
  if (!isRealSecret(secret)) return false
  if (typeof header !== 'string' || !header) return false
  return safeEqual(header, secret)
}

/**
 * The one message an update carries, flattened to the shape parseCommand and
 * the handler expect, or null. Edited messages, channel posts, callbacks and
 * group chats are ignored: the bot answers private chats only.
 */
export function extractUpdate(update) {
  const m = update?.message
  const updateId = Number(update?.update_id)
  if (!m || !Number.isInteger(updateId)) return null
  const chatId = m.chat?.id
  if (m.chat?.type !== 'private' || !Number.isSafeInteger(chatId)) return null
  const base = { updateId, chatId, from: `tg:${chatId}`, timestamp: Number(m.date) || 0 }
  if (m.location) {
    return { ...base, type: 'location', text: '', location: readLocation(m.location) }
  }
  if (typeof m.text === 'string') return { ...base, type: 'text', text: m.text }
  return { ...base, type: 'other', text: '' }
}

/** /start, /help (with or without @botname and a payload). */
export function botCommand(text) {
  const m = /^\/([a-z]+)(?:@\w+)?(?:\s|$)/i.exec(String(text || '').trim())
  return m ? m[1].toLowerCase() : null
}

/** Split on line boundaries so each part is within Telegram's 4096 limit. */
export function splitText(text, max = TG_MAX_TEXT) {
  const parts = []
  let cur = ''
  for (const line of String(text ?? '').split('\n')) {
    let l = line
    while (l.length > max) {
      if (cur) {
        parts.push(cur)
        cur = ''
      }
      parts.push(l.slice(0, max))
      l = l.slice(max)
    }
    const next = cur ? `${cur}\n${l}` : l
    if (next.length > max) {
      parts.push(cur)
      cur = l
    } else cur = next
  }
  if (cur || !parts.length) parts.push(cur)
  return parts
}

/** sendMessage bodies for one reply. Plain text, no parse_mode: nothing to escape. */
export function sendPayloads(chatId, { text, locationRequest } = {}) {
  return splitText(text).map((part, i, all) => {
    const body = { chat_id: chatId, text: part, disable_web_page_preview: true }
    if (locationRequest && i === all.length - 1) {
      body.reply_markup = {
        keyboard: [[{ text: '📍 Send my location', request_location: true }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      }
    }
    return body
  })
}

/**
 * One update, start to finish. ctx = { store, reply(chatId, {text, ...}) → bool,
 * now, orgId } — store as in ../whatsapp/store.js. Returns the log row.
 */
export async function handleUpdate(msg, ctx) {
  const { store, now = new Date(), orgId } = ctx
  const from = msg.from
  const row = {
    orgId: orgId || null,
    uid: null,
    siteId: null,
    intent: null,
    outcome: 'ok',
    channel: 'telegram',
  }
  const done = async (outcome, extra = {}) => {
    Object.assign(row, extra, { outcome })
    await store.log(row, from)
    return row
  }
  const reply = (_to, out) => ctx.reply(msg.chatId, out)

  if (!(await store.claimInbound(`tg-update:${msg.updateId}`)))
    return { ...row, outcome: 'duplicate' }
  if (msg.timestamp && now.getTime() - msg.timestamp * 1000 > MAX_MESSAGE_AGE_MS)
    return done('stale')

  const command = botCommand(msg.text)
  if (command === 'start' || command === 'help') {
    row.intent = 'help'
    await reply(from, { text: TG_HELP })
    return done('help')
  }
  if (msg.type === 'other') {
    row.intent = 'other'
    await reply(from, { text: 'Please send a site code or name, or share your location.' })
    return done('unsupported')
  }

  const cmd = parseCommand(msg)
  row.intent = cmd.kind
  if (cmd.kind === 'link' || cmd.kind === 'badLink' || cmd.kind === 'unlink') {
    await reply(from, { text: 'No linking is needed on Telegram. Send a site code or name.' })
    return done('nolink')
  }
  if (cmd.kind === 'help') {
    await reply(from, { text: TG_HELP })
    return done('help')
  }

  const limit = await store.rate(from, (s) => countQuery(s, now))
  if (limit.verdict !== 'ok') {
    if (limit.verdict === 'notify')
      await reply(from, {
        text: "You've sent a lot of lookups. Please wait a while and try again.",
      })
    return done('ratelimited')
  }

  // The open-access caller: an admin of the configured org reaches every site.
  const user = { uid: null, orgId, role: 'admin', status: 'approved' }
  const out = await answerQuery(cmd, { store, reply, now, from, user, orgId, uid: null })
  return done(out.outcome, out.extra || {})
}

/** POST one sendMessage. Never throws; the token never appears in the result. */
export async function tgSend(token, body, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${TG_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: Boolean(res.ok && data?.ok), status: res.status, error: data?.description || null }
  } catch (err) {
    return { ok: false, status: 0, error: err?.name || 'fetch failed' }
  }
}
