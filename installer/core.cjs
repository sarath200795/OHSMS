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

// ── Who may drive it ────────────────────────────────────────────────────────
// The installer answers at the company's own address, so until WEEHS is
// installed anyone who can reach that address can reach it. A visitor must
// first enter the one-time installer code shown on the server's own screen;
// that sets a session cookie, and every action needs the cookie plus a header
// a cross-site form cannot send.

// No 0/O, 1/I/L: the code is read off one screen and typed on another.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** XXXX-XXXX, about 39 bits; with the lockout below, not guessable. */
function makeInstallerCode(random = randomBytes) {
  const bytes = random(8)
  let out = ''
  for (let i = 0; i < 8; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return `${out.slice(0, 4)}-${out.slice(4)}`
}

/** What a person typed, as the code: case, spaces and the dash forgiven. */
function normalizeCode(value) {
  const raw = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : ''
}

function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return ''
}

/**
 * Wrong codes, counted for the whole installer rather than per visitor: an
 * attacker controls their own address, not the counter. Ten in fifteen
 * minutes and it stops checking until the window passes.
 */
function createLockout({ max = 10, windowMs = 15 * 60 * 1000, now = Date.now } = {}) {
  let failures = []
  return {
    locked() {
      const t = now()
      failures = failures.filter((f) => t - f < windowMs)
      return failures.length >= max
    },
    fail() {
      failures.push(now())
    },
  }
}

/** An action request: the session cookie, and the header forms cannot set. */
function actionAllowed({ cookie, header, session }) {
  return header === '1' && sameSecret(cookieValue(cookie, 'weehs_installer'), session)
}

module.exports = {
  validDomain,
  safeValue,
  buildEnv,
  readEnv,
  sameSecret,
  makeInstallerCode,
  normalizeCode,
  cookieValue,
  createLockout,
  actionAllowed,
}
