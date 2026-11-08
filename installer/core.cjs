// What the installer decides, without touching the system: the settings file
// it writes, the checks on what a person typed, and who may drive it. Kept
// apart from installer.cjs so it can be tested without Docker or a browser.
//
// CommonJS on purpose: Node's single-executable build (build.mjs) runs one
// CommonJS script, and this file is bundled into it.

'use strict'

const { randomBytes, timingSafeEqual } = require('node:crypto')

/** A host name people type: no scheme, no path, no port. */
function validDomain(value) {
  const d = String(value || '').trim()
  if (!d || d.length > 253) return false
  if (/^https?:\/\//i.test(d)) return false
  return /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(
    d
  )
}

/** One line of .env: printable, no line break that could start another key. */
function safeValue(value) {
  return typeof value === 'string' && !/[\r\n\0]/.test(value) && value.length <= 512
}

/**
 * The settings file, from the kit's .env.example with every value filled.
 * The random values are generated exactly as docs/SELF-HOSTING.md says:
 * hex for the database passwords (safe inside a connection URL), 32 bytes of
 * base64 for STATE_KEY and DATA_KEY_MASTER (the only form the app accepts).
 */
function buildEnv(example, { domain, image, mail = {} }, random = randomBytes) {
  const values = {
    WEEHS_IMAGE: image,
    DOMAIN: domain,
    DB_ADMIN_PASSWORD: random(24).toString('hex'),
    APP_DB_PASSWORD: random(24).toString('hex'),
    STATE_KEY: random(32).toString('base64'),
    CONTROL_TOKEN: random(32).toString('hex'),
    SESSION_SECRET: random(32).toString('hex'),
    DATA_KEY_MASTER: random(32).toString('base64'),
  }
  if (mail.host) {
    values.SMTP_HOST = mail.host
    values.SMTP_PORT = String(mail.port || '587')
    values.SMTP_USER = mail.user || ''
    values.SMTP_PASS = mail.pass || ''
    values.MAIL_FROM = mail.from || ''
  }
  for (const [key, value] of Object.entries(values)) {
    if (!safeValue(value)) throw new Error(`${key} is not a value .env can hold`)
  }
  const seen = new Set()
  const lines = String(example)
    .split(/\r?\n/)
    .map((line) => {
      const m = /^([A-Z0-9_]+)=/.exec(line)
      if (!m || !(m[1] in values)) return line
      seen.add(m[1])
      return `${m[1]}=${values[m[1]]}`
    })
  const missing = Object.keys(values).filter((k) => !seen.has(k))
  if (missing.length) throw new Error(`.env.example has no line for ${missing.join(', ')}`)
  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}

function readEnv(text) {
  const out = {}
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (m) out[m[1]] = m[2]
  }
  return out
}

function sameSecret(a, b) {
  const x = Buffer.from(String(a || ''))
  const y = Buffer.from(String(b || ''))
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y)
}

/**
 * The installer listens on loopback, but a web page in the same browser can
 * still send requests to it, and a DNS name can be pointed at 127.0.0.1. So a
 * request must name this exact address in Host (no rebinding) and carry the
 * one-time token the installer printed in its own URL (no cross-site driving:
 * a custom header cannot be set by a form, and the token is unguessable).
 */
function allowedRequest({ host, token, expectedHost, expectedToken }) {
  return String(host || '') === expectedHost && sameSecret(token, expectedToken)
}

module.exports = { validDomain, safeValue, buildEnv, readEnv, sameSecret, allowedRequest }
