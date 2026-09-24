// ─────────────────────────────────────────────────────────────────────────────
// Outbound mail. Nothing else in this repo sends it — a previous mail API key
// was removed (functions/index.js, LOW-13) and not replaced — so this file is
// the one path. The relay is Brevo (smtp-relay.brevo.com, port 587, STARTTLS).
// The From address stays info@weehs.org. Brevo will refuse it until that
// domain is a verified sender; this file does not substitute another address.
//
// SMTP_USER is the Brevo SMTP login, not the From mailbox. SMTP_PASS is the
// SMTP key. Neither is a default: a guessed login would authenticate as the
// wrong account, and a key in this file would be the LOW-13 finding again.
// Both are passed in. This module does not touch Secret Manager, so the
// tests can run it with a plain object. A missing login or key refuses to
// send; it does not pretend the message went out.
// ─────────────────────────────────────────────────────────────────────────────

import { prepareAttachments } from './mailAttachments.js'
import { isProductBrandName, mailSenderName, NEUTRAL_SENDER } from './mailBrand.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The address on the From header. Not the Brevo SMTP login. */
export const MAILBOX_ADDRESS = 'info@weehs.org'

/** Brevo relay and the From mailbox, unless an env value overrides them. */
export const DEFAULT_MAIL = {
  host: 'smtp-relay.brevo.com',
  port: '587',
  // The Brevo SMTP login. Not the From address, and not known here.
  user: '',
  // Display name only. The address is the mailbox. Callers that know the
  // organisation replace this with its name; see applySenderName.
  from: `${NEUTRAL_SENDER} <${MAILBOX_ADDRESS}>`,
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
  if (!config.user) missing.push('SMTP_USER')
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

/**
 * Nodemailer options for this config. 587 is STARTTLS (`secure: false` and
 * `requireTLS`). 465 is implicit TLS. Any other port does neither, so a
 * mistaken port cannot silently send in the clear on 587's behalf.
 */
export function transportOptions(config) {
  return {
    host: config.host,
    port: config.port,
    secure: config.port === 465,
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
  }
}

async function defaultTransport(config) {
  const loaded = await import('nodemailer')
  const lib = typeof loaded.createTransport === 'function' ? loaded : loaded.default
  return lib.createTransport(transportOptions(config))
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
