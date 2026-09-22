// ─────────────────────────────────────────────────────────────────────────────
// Outbound mail. There was no provider in this repo — a previous mail API key
// was removed (functions/index.js, LOW-13) rather than replaced — so this is
// the one path. SMTP via nodemailer, because the operator already has a mail
// host and naming a second vendor here would put it on the subprocessor list
// by default.
//
// The password is a secret (SMTP_PASS), read by the caller and passed in.
// This module does not touch Secret Manager, so the tests can run it with a
// plain object. An unconfigured transport refuses to send; it does not
// pretend the message went out.
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

export function mailConfigFrom(env = {}) {
  const portNum = Number(env.SMTP_PORT)
  const port = Number.isInteger(portNum) && portNum > 0 && portNum < 65536 ? portNum : 587
  const config = {
    host: String(env.SMTP_HOST || '').trim(),
    port,
    user: String(env.SMTP_USER || '').trim(),
    pass: String(env.SMTP_PASS || ''),
    from: parseFrom(env.MAIL_FROM),
    appOrigin: safeOrigin(env.APP_ORIGIN),
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
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    // The body is text we built. These stop a crafted body from making the
    // transport read a local file or fetch a URL anyway.
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
    async send({ to, subject, text }) {
      const missing = describeMailGap(config)
      if (missing.length) {
        const err = new Error(`Mail is not configured (missing ${missing.join(', ')})`)
        err.code = 'mail/not-configured'
        throw err
      }
      if (!transport) transport = await defaultTransport(config)
      await transport.sendMail({ from: config.from, to, subject, text })
    },
  }
}
