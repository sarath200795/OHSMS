// ─────────────────────────────────────────────────────────────────────────────
// Outbound mail. Nothing else in this repo sends it — a previous mail API key
// was removed (functions/index.js, LOW-13) and not replaced — so this file is
// the one path. It does not stand up a second provider. info@weehs.org is an
// existing Private Email mailbox (MX: mx1/mx2.privateemail.com). SMTP to
// mail.privateemail.com is how that mailbox sends. The password is the only
// thing that is not already determined: SMTP_PASS, the mailbox password.
//
// The password is passed in. This module does not touch Secret Manager, so
// the tests can run it with a plain object. A missing password refuses to
// send; it does not pretend the message went out.
// ─────────────────────────────────────────────────────────────────────────────

import { prepareAttachments } from './mailAttachments.js'
import { isProductBrandName, mailSenderName, NEUTRAL_SENDER } from './mailBrand.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The mailbox assignment mail sends as, unless an env value overrides it. */
export const DEFAULT_MAIL = {
  host: 'mail.privateemail.com',
  port: '465',
  user: 'info@weehs.org',
  // Display name only. The address is the mailbox. Callers that know the
  // organisation replace this with its name; see applySenderName.
  from: `${NEUTRAL_SENDER} <info@weehs.org>`,
  appOrigin: 'https://suite.weehs.org',
}

/** A bare address, or `Name <addr@host>`. Anything else is not a From. */
export function parseFrom(value) {
  const raw = String(value || '')
    .replace(/[\r\n]/g, '')
    .trim()
  const angled = raw.match(/^(.*)<([^<>]+)>$/)
  if (angled) {
    const email = angled[2].trim()
    const name = angled[1].trim().replace(/^"|"$/g, '')
    // A colon in the display name is how a second header gets introduced
    // (`Evil\nBcc: x <good@host>`). The address is kept; the name is not.
    if (!name || /["<>:]/.test(name)) return email
    return `${name} <${email}>`
  }
  return EMAIL_RE.test(raw) ? raw : ''
}

/**
 * From header for one message. The address is always the configured mailbox.
 * `displayName` (the organisation, when the mail has one) replaces the name
 * in front of it. A configured name that is only the old product name is
 * replaced too, so a MAIL_FROM left over from before that change does not
 * put the name back in the inbox.
 */
export function applySenderName(configuredFrom, displayName) {
  const parsed = parseFrom(configuredFrom)
  const angled = parsed.match(/^(.*)<([^<>]+)>$/)
  const address = angled ? angled[2].trim() : ''
  const bare = !angled && EMAIL_RE.test(parsed) ? parsed : ''
  const mailbox = address || bare
  if (!mailbox) return parsed
  const requested = mailSenderName(displayName)
  if (requested) return parseFrom(`${requested} <${mailbox}>`) || mailbox
  if (!angled) return mailbox
  const current = angled[1].trim()
  if (current && !isProductBrandName(current)) return parsed
  return parseFrom(`${NEUTRAL_SENDER} <${mailbox}>`) || mailbox
}

export function mailConfigFrom(env = {}) {
  const portRaw = env.SMTP_PORT
  const portBlank = portRaw === undefined || String(portRaw).trim() === ''
  const portNum = portBlank ? Number(DEFAULT_MAIL.port) : Number(portRaw)
  const port =
    Number.isInteger(portNum) && portNum > 0 && portNum < 65536
      ? portNum
      : Number(DEFAULT_MAIL.port)
  const config = {
    host: String(env.SMTP_HOST || '').trim() || DEFAULT_MAIL.host,
    port,
    user: String(env.SMTP_USER || '').trim() || DEFAULT_MAIL.user,
    pass: String(env.SMTP_PASS || ''),
    from: applySenderName(parseFrom(env.MAIL_FROM) || parseFrom(DEFAULT_MAIL.from)),
    appOrigin: safeOrigin(env.APP_ORIGIN) || safeOrigin(DEFAULT_MAIL.appOrigin),
  }
  config.configured = describeMailGap(config).length === 0
  return config
}

/** Names the settings that are still empty. The order is the setup order. */
export function describeMailGap(config = {}) {
  const missing = []
  if (!config.host) missing.push('SMTP_HOST')
  if (!config.from) missing.push('MAIL_FROM')
  if (!config.pass) missing.push('SMTP_PASS')
  return missing
}

/**
 * Absolute origin for links, or '' when the value is not a usable http(s) URL.
 * A missing origin still sends the mail; the body carries the in-app path
 * instead of a link. Credentials in the origin are refused — they would be
 * copied into every message.
 */
export function safeOrigin(value) {
  const raw = String(value || '')
    .trim()
    .replace(/\/+$/, '')
  if (!/^https?:\/\/\S+$/.test(raw)) return ''
  try {
    const url = new URL(raw)
    if (url.username || url.password) return ''
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return url.origin
  } catch {
    return ''
  }
}

async function defaultTransport(config) {
  const loaded = await import('nodemailer')
  const lib = typeof loaded.createTransport === 'function' ? loaded : loaded.default
  return lib.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    // 587 is STARTTLS. Require it so a fallback port cannot send in the clear.
    requireTLS: config.port === 587,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    // A text body fits in 15s. A permit pack can be several megabytes, and a
    // short socket timeout is how that mail dies after the ledger has already
    // claimed it.
    socketTimeout: 60_000,
    // The body is the text and HTML this process built. Attachments are
    // buffers it already holds — never a path and never a URL. These stop a
    // crafted message from making the transport read a local file or fetch
    // one anyway.
    disableFileAccess: true,
    disableUrlAccess: true,
  })
}

/**
 * `deps.transport` injects a fake in tests. The real transport is created on
 * the first send, not at construction, so importing this module does not load
 * nodemailer and an unconfigured function does not open a socket.
 */
export function createMailer(env = {}, deps = {}) {
  const config = mailConfigFrom(env)
  let transport = deps.transport || null
  return {
    config,
    async send({ to, subject, text, html, attachments, senderName }) {
      const missing = describeMailGap(config)
      if (missing.length) {
        const err = new Error(`Mail is not configured (missing ${missing.join(', ')})`)
        err.code = 'mail/not-configured'
        throw err
      }
      if (!transport) transport = await defaultTransport(config)
      const message = { from: applySenderName(config.from, senderName), to, subject, text }
      // Both parts: nodemailer sends them as multipart/alternative, so a
      // client that cannot render HTML still gets the text. Callers with no
      // template omit html and stay text-only.
      if (typeof html === 'string' && html.trim()) message.html = html
      // Only the buffers prepareAttachments kept. path and href are not
      // copied, so the two disable* flags above are not the only thing
      // standing between a candidate and the socket.
      const files = prepareAttachments(attachments).accepted
      if (files.length) {
        message.attachments = files.map(({ filename, content, contentType }) => ({
          filename,
          content,
          contentType,
          contentDisposition: 'attachment',
        }))
      }
      await transport.sendMail(message)
    },
  }
}
