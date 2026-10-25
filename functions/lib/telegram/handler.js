// ─────────────────────────────────────────────────────────────────────────────
// Telegram site lookup: the same lookup as WhatsApp (../whatsapp/handler.js
// answerQuery), reached through a Telegram bot webhook.
//
// ACCESS: WhatsApp answers only numbers linked to an approved app user, and
// only the organisation that profile belongs to. Telegram gives a bot no
// phone number, so there is nothing to match against /users. By the owner's
// decision this channel is OPEN: anyone who messages the bot can look up
// sites, with exactly the reply WhatsApp would give an admin of the chosen
// organisation. TG_ORG_ID, when set, pins that to one organisation. When it
// is empty the bot asks which organisation. It does not recite the customer
// list unless TG_LIST_ORGS=true and there are at most ten names; the default
// is to ask for the name. Rate limits, the global daily cap and the query
// log (no message text, chat id hashed) apply as for WhatsApp.
// TG_ENABLED=false switches it off.
// ─────────────────────────────────────────────────────────────────────────────
import { parseCommand, readLocation } from '../whatsapp/parse.js'
import { guideConversation, MAX_MESSAGE_AGE_MS } from '../whatsapp/handler.js'
import { CENTRE_PROMPT } from '../whatsapp/format.js'
import { countQuery } from '../whatsapp/rateLimit.js'
import { safeEqual, isRealSecret } from '../whatsapp/signature.js'

export const TG_MAX_TEXT = 4096
export const TG_API = 'https://api.telegram.org'

export const TG_HELP =
  'WeEHS site lookup.\n\n' +
  `I ask which organisation, then: ${CENTRE_PROMPT} ` +
  "The reply is that centre's safety summary: extinguishers, AED availability, open defects, " +
  'first aid boxes, pending actions, incidents, the last audit score and emergency contacts.\n\n' +
  'Say MENU to start over, or CHANGE ORG to pick a different organisation.\n\n' +
  "Can't remember the centre? After the organisation is chosen, share your location " +
  '(📎 → Location) for the nearest sites.\n\n' +
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
  const updateId = Number(update?.update_id)
  if (!Number.isInteger(updateId)) return null
  // A tap on an inline button. The button's message can be hours old; the tap
  // itself is now, so timestamp 0 skips the stale-message check. No spinner
  // is left running: the caller answers the callback.
  const q = update?.callback_query
  if (q) {
    const chat = q.message?.chat
    const chatId = chat?.id
    if (chat?.type !== 'private' || !Number.isSafeInteger(chatId)) return null
    return {
      updateId,
      chatId,
      from: `tg:${chatId}`,
      timestamp: 0,
      type: 'text',
      text: '',
      choiceId: String(q.data || ''),
      callbackQueryId: typeof q.id === 'string' ? q.id : '',
    }
  }
  const m = update?.message
  if (!m) return null
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
export function sendPayloads(chatId, { text, locationRequest, rows } = {}) {
  const parts = splitText(text)
  return parts.map((part, i) => {
    const body = { chat_id: chatId, text: part, disable_web_page_preview: true }
    const last = i === parts.length - 1
    if (!last) return body
    if (locationRequest) {
      body.reply_markup = {
        keyboard: [[{ text: '📍 Send my location', request_location: true }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      }
    } else if (rows?.length) {
      // One name per row. callback_data is the choice id (org: or site:), already
      // bounded by the caller; slice again so a bad row cannot exceed Telegram's 64 bytes.
      body.reply_markup = {
        inline_keyboard: rows.slice(0, 10).map((r) => [
          {
            text: String(r.label || r.title || r.id).slice(0, 64),
            callback_data: String(r.id).slice(0, 64),
          },
        ]),
      }
    }
    return body
  })
}

/** Dismiss the loading state on an inline button. The token stays out of the result. */
export async function tgAnswerCallback(token, callbackQueryId, fetchImpl = fetch) {
  if (!callbackQueryId) return { ok: true, status: 0, error: null }
  try {
    const res = await fetchImpl(`${TG_API}/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: Boolean(res.ok && data?.ok), status: res.status, error: data?.description || null }
  } catch (err) {
    return { ok: false, status: 0, error: err?.name || 'fetch failed' }
  }
}

/**
 * One update, start to finish. ctx = { store, reply(chatId, {text, rows?}) → bool,
 * answerCallback?(id), now, orgs: [{id, name}], listOrgs?: bool, orgId? }.
 * `orgId` alone is the one-organisation caller (older tests and a pinned bot).
 * store as in ../whatsapp/store.js. Returns the log row.
 */
export async function handleUpdate(msg, ctx) {
  const { store, now = new Date() } = ctx
  const orgs = Array.isArray(ctx.orgs)
    ? ctx.orgs
    : ctx.orgId
      ? [{ id: ctx.orgId, name: ctx.orgName || ctx.orgId }]
      : []
  const from = msg.from
  const row = {
    orgId: null,
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
  const ack = () =>
    msg.callbackQueryId && ctx.answerCallback ? ctx.answerCallback(msg.callbackQueryId) : null

  if (!(await store.claimInbound(`tg-update:${msg.updateId}`))) {
    await ack()
    return { ...row, outcome: 'duplicate' }
  }
  await ack()
  if (msg.timestamp && now.getTime() - msg.timestamp * 1000 > MAX_MESSAGE_AGE_MS)
    return done('stale')

  const command = botCommand(msg.text)
  if (command === 'help') {
    row.intent = 'help'
    await reply(from, { text: TG_HELP })
    return done('help')
  }
  if (msg.type === 'other') {
    row.intent = 'other'
    await reply(from, {
      text: `Send an organisation name, or share your location. ${CENTRE_PROMPT}`,
    })
    return done('unsupported')
  }

  const forced =
    command === 'start' || command === 'menu'
      ? { kind: 'menu' }
      : command === 'changeorg' || command === 'org'
        ? { kind: 'changeOrg' }
        : null
  const cmd = forced || parseCommand(msg)
  row.intent = cmd.kind
  if (cmd.kind === 'link' || cmd.kind === 'badLink' || cmd.kind === 'unlink') {
    await reply(from, {
      text: `No linking is needed on Telegram. Send an organisation name, then the Centre ID or Centre Name.`,
    })
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

  // Open channel: admin of whichever organisation they are allowed to name.
  // Not an admin of every organisation at once — guideConversation picks one.
  const user = { uid: null, orgId: null, role: 'admin', status: 'approved', channelAdmin: true }
  const out = await guideConversation(cmd, {
    store,
    reply,
    now,
    from,
    user,
    uid: null,
    orgs,
    listOrgs: ctx.listOrgs === true,
  })
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
