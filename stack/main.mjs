// Entry point for a deployed dedicated environment (Cloud Run, or any host
// that runs a container). Reads the environment, refuses to start with a
// setting missing or weak, and serves. docs/CONTROL-PLANE.md lists every
// variable and where each comes from.

import nodemailer from 'nodemailer'
import { createDedicatedApp } from './app.mjs'
import { createPgDatabase } from './pg.mjs'
import { parseStateKey } from './state.mjs'

const env = process.env
const problems = []

function required(name, { min = 1 } = {}) {
  const value = String(env[name] || '').trim()
  if (value.length < min) {
    problems.push(min > 1 ? `${name} (at least ${min} characters)` : name)
  }
  return value
}

const databaseUrl = required('DATABASE_URL')
const origin = required('PUBLIC_ORIGIN').replace(/\/$/, '')
const controlToken = required('CONTROL_TOKEN', { min: 32 })
const sessionSecret = required('SESSION_SECRET', { min: 32 })
const dataKeyMaster = required('DATA_KEY_MASTER', { min: 32 })
const stateKeyRaw = required('STATE_KEY')

// The handoff link and every session redirect are built on this origin, and
// intake refuses an http one that is not loopback. Fail here, not on the
// first company's handoff.
if (origin && !/^https:\/\/[^/\s]+$/.test(origin)) {
  problems.push('PUBLIC_ORIGIN (an https:// origin with no path)')
}

let stateKey
if (stateKeyRaw) {
  try {
    stateKey = parseStateKey(stateKeyRaw)
  } catch (err) {
    problems.push(err.message)
  }
}

if (problems.length) {
  process.stderr.write(
    `dedicated environment refused to start. Missing or invalid: ${problems.join(', ')}\n`
  )
  process.exit(1)
}

// Mail is optional. Without it the control plane returns the handoff token to
// the operator who filed the request, once, instead of mailing it.
let mail = null
if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.MAIL_FROM) {
  const port = Number(env.SMTP_PORT || 587)
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  })
  mail = async ({ to, subject, text }) => {
    try {
      await transport.sendMail({ from: env.MAIL_FROM, to, subject, text })
      return { sent: true }
    } catch (err) {
      process.stderr.write(`mail not sent: ${subject} (${err?.code || err?.message})\n`)
      return { sent: false }
    }
  }
}

const db = createPgDatabase(databaseUrl, { max: Number(env.DB_POOL_MAX || 5) })
const { server } = await createDedicatedApp({
  db,
  stateKey,
  origin,
  sessionSecret,
  controlToken,
  dataKeyMaster,
  mail,
  staticDir: env.STATIC_DIR || new URL('./public', import.meta.url).pathname,
})

const port = Number(env.PORT || 8080)
server.listen(port, '0.0.0.0', () => {
  process.stdout.write(
    `dedicated environment listening on ${port} for ${origin}${mail ? '' : ' (mail off)'}\n`
  )
})

// Cloud Run sends SIGTERM before it stops an instance.
process.on('SIGTERM', () => {
  server.close(() => db.end().finally(() => process.exit(0)))
  setTimeout(() => process.exit(0), 8000).unref()
})
