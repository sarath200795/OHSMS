// ─────────────────────────────────────────────────────────────────────────────
// Telegram site lookup: the same lookup as WhatsApp (../whatsapp/handler.js
// answerQuery), reached through a Telegram bot webhook.
//
// ACCESS: the same rule as WhatsApp. A chat is answered only after it has
// redeemed a link code issued to a signed-in approved member (Settings →
// Security). Every later message re-reads that member's live profile: approved,
// own password, organisation still the one on the link. The reply uses that
// profile's role and site grants, not an admin the message claims to be.
// TG_ORG_ID, when set, is a further refusal — this deployment will not answer
// for any other organisation — and is not itself a login. An unbound chat
// gets instructions to link and nothing else: no organisation names, no sites,
// no contacts. Rate limits, the global daily cap and the query log (no message
// text, chat id hashed) apply as for WhatsApp. TG_ENABLED=false switches it off.
// ─────────────────────────────────────────────────────────────────────────────
import { parseCommand, readLocation } from '../whatsapp/parse.js'
import { guideConversation, MAX_MESSAGE_AGE_MS } from '../whatsapp/handler.js'
import { CENTRE_PROMPT } from '../whatsapp/format.js'
import { countBadLink, countQuery, linkBlocked } from '../whatsapp/rateLimit.js'
import { safeEqual, isRealSecret } from '../whatsapp/signature.js'
import { isActiveMember } from '../whatsapp/access.js'
import { orgsForLinkedUser } from '../whatsapp/orgs.js'

export const TG_MAX_TEXT = 4096
export const TG_API = 'https://api.telegram.org'

export const TG_HELP =
  'WeEHS site lookup for a linked account.\n\n' +
  'Link this chat from Settings → Security in the app, then send the LINK code here. ' +
  `After that: ${CENTRE_PROMPT} ` +
  'The reply covers only sites you can already open in the app.\n\n' +
  'Say MENU to start over. Share your location (📎 → Location) for the nearest of those sites.\n\n' +
  'Send UNLINK to disconnect this chat.\n\n' +
  'In an emergency call 112.'

export const TG_UNBOUND =
  'This chat is not linked to an account.\n\n' +
  'In the app, open Settings → Security, choose Link Telegram, and send the LINK code from this chat.\n\n' +
  'In an emergency call 112.'

export const TG_DENIED =
  'Site lookup is not available for this account.\n\nIn an emergency call 112.'

export const TG_LINKED =
  'Linked. Send a Centre ID or Centre Name for a site you can already open in the app.\n\n' +
  'In an emergency call 112.'

export const TG_UNLINKED = 'This chat is disconnected.\n\nIn an emergency call 112.'

export const TG_LINK_FAILED =
  'That code is not valid. Ask for a new one in Settings → Security.\n\nIn an emergency call 112.'

export const TG_BAD_LINK =
  'Send LINK followed by the six-digit code from Settings → Security.\n\nIn an emergency call 112.'

export const TG_LINK_BLOCKED =
  'Too many codes from this chat. Try again tomorrow.\n\nIn an emergency call 112.'

export const TG_ORG_OFF =
  'Site lookup is switched off for this account.\n\nIn an emergency call 112.'

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
export function sendPayloads(chatId, { text, locationRequest, rows, buttons } = {}) {
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
    } else if (buttons?.length) {
      // Yes and No on one row. callback_data is audit:yes / audit:no.
      body.reply_markup = {
        inline_keyboard: [
          buttons.slice(0, 3).map((button) => ({
            text: String(button.title || button.label || button.id).slice(0, 64),
            callback_data: String(button.id).slice(0, 64),
          })),
        ],
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
 * answerCallback?(id), now, pinnedOrgId? }.
 * `pinnedOrgId`, when set, refuses every account that does not belong to that
 * organisation. It does not authorise a chat by itself. `orgs` and `orgId` on
 * ctx are ignored: a caller-supplied directory is not an identity.
 * store as in ../whatsapp/store.js. Returns the log row.
 */
export async function handleUpdate(msg, ctx) {
  const { store, now = new Date() } = ctx
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

  const forced =
    command === 'start' || command === 'menu'
      ? { kind: 'menu' }
      : command === 'changeorg' || command === 'org'
        ? { kind: 'changeOrg' }
        : null
  const cmd = forced || parseCommand(msg)
  row.intent = cmd.kind

  if (cmd.kind === 'link' || cmd.kind === 'badLink') {
    if (typeof store.redeemTelegramCode !== 'function') {
      await reply(from, { text: TG_UNBOUND })
      return done('unknown')
    }
    const blocked = await store.rate(from, (s) => ({ state: s, blocked: linkBlocked(s, now) }))
    if (blocked.blocked) return done('blocked')
    if (cmd.kind === 'badLink') {
      await reply(from, { text: TG_BAD_LINK })
      return done('badlink')
    }
    const result = await store.redeemTelegramCode(cmd.code, from)
    if (!result?.ok) {
      const after = await store.rate(from, (s) => countBadLink(s, now))
      await reply(from, { text: after.blocked ? TG_LINK_BLOCKED : TG_LINK_FAILED })
      return done('linkfailed')
    }
    if (store.clearSession) await store.clearSession(from)
    await reply(from, { text: TG_LINKED })
    return done('linked', { orgId: result.orgId, uid: result.uid })
  }

  // The chat id on the verified update is the only identity. Text in the
  // message, a tapped organisation id, and ctx.orgs are not.
  const link = typeof store.getTelegramLink === 'function' ? await store.getTelegramLink(from) : null
  const user = link && typeof store.getUser === 'function' ? await store.getUser(link.uid) : null
  const pinned = typeof ctx.pinnedOrgId === 'string' ? ctx.pinnedOrgId.trim() : ''
  const active = Boolean(link) && isActiveMember(user, link.orgId) && (!pinned || user.orgId === pinned)

  if (!active) {
    if (cmd.kind === 'unlink' && link && typeof store.unlinkTelegram === 'function') {
      await store.unlinkTelegram(from)
      if (store.clearSession) await store.clearSession(from)
      await reply(from, { text: TG_UNLINKED })
      return done('unlinked', { uid: link.uid })
    }
    await reply(from, { text: link ? TG_DENIED : TG_UNBOUND })
    return done(link ? 'denied' : 'unknown', link ? { uid: link.uid, orgId: link.orgId } : {})
  }

  if (cmd.kind === 'unlink') {
    await store.unlinkTelegram(from)
    if (store.clearSession) await store.clearSession(from)
    await reply(from, { text: TG_UNLINKED })
    return done('unlinked', { uid: user.uid, orgId: user.orgId })
  }

  if (
    typeof store.orgLookupEnabled === 'function' &&
    (await store.orgLookupEnabled(link.orgId)) === false
  ) {
    await reply(from, { text: TG_ORG_OFF })
    return done('org-off', { uid: user.uid, orgId: user.orgId })
  }

  const limit = await store.rate(from, (s) => countQuery(s, now))
  if (limit.verdict !== 'ok') {
    if (limit.verdict === 'notify')
      await reply(from, {
        text: "You've sent a lot of lookups. Please wait a while and try again.",
      })
    return done('ratelimited', { uid: user.uid, orgId: user.orgId })
  }

  let orgs = []
  if (typeof store.getOrganization === 'function') {
    const record = await store.getOrganization(user.orgId)
    orgs = record ? orgsForLinkedUser(user, record) : []
  } else {
    orgs = orgsForLinkedUser(user, { id: user.orgId, name: user.orgName || '' })
  }
  const out = await guideConversation(cmd, {
    store,
    reply,
    now,
    from,
    user,
    uid: user.uid,
    orgs,
    // Never the customer directory. One organisation is named because it is
    // this profile's; several would be listed only if listOrgs were true.
    listOrgs: false,
  })
  return done(out.outcome, { ...(out.extra || {}), orgId: out.extra?.orgId || user.orgId, uid: user.uid })
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
