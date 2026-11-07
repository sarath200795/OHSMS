// ─────────────────────────────────────────────────────────────────────────────
// Mail at registration.
//
// Nothing was sent when an organization registered, on either path, and the
// first thing a new founder reported was "I did not get an email". Two mails
// close that:
//
//   - Own database. The wizard files provisioningRequests/{id} and stops. The
//     founder is told the request arrived and what happens next, and each
//     platform operator is told there is a request waiting — before this, a
//     request could sit unseen until someone opened /platform/provisioning.
//     This mail is NOT the secret handoff. The one-time link is issued by the
//     control plane (stack/server.mjs) and only it holds the token.
//   - WEEHS database. registerOrganization creates organizations/{id}; the
//     founder is welcomed and given the link to the suite.
//
// The own-database request is created WITHOUT signing in (firestore.rules,
// /provisioningRequests), so its contact address is whatever the person filing
// typed. A mail to it on create is a mail to a stranger's inbox on a
// stranger's say-so. Three things keep that from being a way to use this
// mailbox against someone:
//   - THROTTLE: at most PER_ADDRESS_PER_DAY to one address a day, and
//     GLOBAL_PER_HOUR in total an hour, counted in mailThrottle/{hash}, which
//     holds a count and an expiry and never the address.
//   - The mail says what to do if you did not file it: nothing. Nothing was
//     created and no account exists.
//   - No link the filer controls. Their text reaches the mail only as a
//     bounded line, and the rules already refuse "://" in it.
//
// The welcome mail has no such exposure: it goes to the Firebase Auth address
// of the user who created the org, and Auth allows one account per address,
// so one address can be welcomed once. It deliberately does not use the
// org's notificationEmail, which the client wrote.
// ─────────────────────────────────────────────────────────────────────────────
import { notificationId, sendOnce } from './notify.js'
import { describeMailGap, safeOrigin } from './mailer.js'
import { mailboxAddress } from './mailAddress.js'
import { renderLayout } from './mailTemplates/layout.js'
import { safeLine } from './mailTemplates/safe.js'

export const PER_ADDRESS_PER_DAY = 3
export const GLOBAL_PER_HOUR = 30
export const MAX_OPERATORS = 10

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// Labels for the choices the wizard records. The wizard's own copy lives in
// src/shared/org/provisioningSchema.js, a different npm package; an id this
// map does not know is shown as the id, so a new option still reads.
const HOSTING = {
  bring: 'Your own database',
  'company-cloud': 'Postgres provisioned in your cloud account',
  'weehs-operated': 'A dedicated project operated by WEEHS',
}
const SIGN_IN = { oidc: 'Company OIDC', saml: 'Company SAML', supabase: 'Supabase Auth' }
const FILES = { provision: 'A bucket WEEHS provisions', bring: 'Your own bucket' }

function noopLogger() {
  return { info() {}, error() {} }
}

function line(value, max = 120) {
  return safeLine(typeof value === 'string' ? value : '', max)
}

function linkTo(appOrigin, path) {
  const origin = safeOrigin(appOrigin)
  return origin ? `${origin}${path}` : ''
}

// ── Templates ───────────────────────────────────────────────────────────────

export function renderRequestReceivedMail(request = {}, { requestId = '' } = {}) {
  const orgName = line(request.orgName)
  const id = line(requestId, 40)
  const handoff = mailboxAddress(request.handoffContact) || mailboxAddress(request.contactEmail)
  const subject = safeLine(
    orgName ? `We received your request for ${orgName}` : 'We received your request',
    120
  )
  const rows = [
    { label: 'Organization', value: orgName },
    { label: 'Request', value: id },
    { label: 'Database', value: line(HOSTING[request.mode] || request.mode) },
    { label: 'Engine', value: line(request.engine, 40) },
    { label: 'Sign-in', value: line(SIGN_IN[request.authMethod] || request.authMethod) },
    { label: 'File store', value: line(FILES[request.bucketMode] || request.bucketMode) },
  ]
  const blocks = [
    {
      label: 'What happens next',
      text:
        `Your organization is not live yet. ${handoff || 'Your handoff contact'} will receive a ` +
        'separate one-time secure link to submit the database credentials, identity-provider ' +
        'secrets and DATA_KEY_MASTER. When that is complete, you will be emailed the address ' +
        "of your organization's dedicated site.",
    },
    {
      label: 'Keep secrets out of email',
      text: 'Never send passwords, keys or certificates by email, and do not reply to this message with them.',
    },
    {
      label: 'Did not file this?',
      text:
        'Anyone can type an address into a registration form. If this was not you, you can ' +
        'ignore this email: nothing was created and no account exists for you.',
    },
  ]
  const { text, html, senderName } = renderLayout({
    subject,
    label: 'Registration',
    headline: 'Your request to use your own database was received.',
    rows,
    blocks,
    url: '',
    path: '',
  })
  return { subject, text, html, senderName }
}

export function renderOperatorAlertMail(request = {}, { requestId = '', appOrigin = '' } = {}) {
  const orgName = line(request.orgName)
  const subject = safeLine(
    orgName ? `New own-database request: ${orgName}` : 'New own-database request',
    120
  )
  const path = '/platform/provisioning'
  const { text, html, senderName } = renderLayout({
    subject,
    label: 'Provisioning',
    headline: 'An organization asked to use its own database.',
    rows: [
      { label: 'Organization', value: orgName },
      { label: 'Request', value: line(requestId, 40) },
      { label: 'Contact', value: mailboxAddress(request.contactEmail) },
      { label: 'Database', value: line(HOSTING[request.mode] || request.mode) },
      { label: 'Sign-in', value: line(SIGN_IN[request.authMethod] || request.authMethod) },
      { label: 'File store', value: line(FILES[request.bucketMode] || request.bucketMode) },
    ],
    blocks: [
      {
        label: 'Next step',
        text: 'File it on the control plane to send the one-time secret handoff link. Until then the request stays requested.',
      },
    ],
    actionLabel: 'Open provisioning requests',
    url: linkTo(appOrigin, path),
    path,
  })
  return { subject, text, html, senderName }
}

export function renderWelcomeMail({ orgName = '', name = '' } = {}, { appOrigin = '' } = {}) {
  const org = line(orgName)
  const person = line(name, 80)
  const subject = safeLine(org ? `Welcome to WEEHS, ${org}` : 'Welcome to WEEHS', 120)
  const path = '/portal'
  const { text, html, senderName } = renderLayout({
    subject,
    label: 'Welcome',
    headline: person
      ? `Welcome, ${person}. Your organization is ready.`
      : 'Your organization is ready.',
    rows: [
      { label: 'Organization', value: org },
      { label: 'Your role', value: 'Administrator' },
    ],
    blocks: [
      {
        label: 'Getting started',
        text:
          'Sign in to add your sites, invite your team from Employees, and set your logo and ' +
          'preferences in Org Settings.',
      },
      {
        label: 'Did not register?',
        text: 'If you did not create this organization, contact info@weehs.org.',
      },
    ],
    actionLabel: 'Open WEEHS',
    url: linkTo(appOrigin, path),
    path,
  })
  return { subject, text, html, senderName }
}

// ── Throttle ────────────────────────────────────────────────────────────────

/**
 * Count one send against `limit` in window `windowMs`. True when it fits.
 * The document id is a hash, and the document holds a count and an expiry:
 * the address it limits is not stored.
 */
export async function takeThrottle(db, { key, limit, windowMs, now = new Date() }) {
  const window = Math.floor(now.getTime() / windowMs)
  const ref = db.doc(`mailThrottle/${notificationId(['registration', ...key, window])}`)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const count = snap.exists ? Number(snap.data()?.count) || 0 : 0
    if (count >= limit) return false
    tx.set(ref, {
      count: count + 1,
      expiresAt: new Date((window + 1) * windowMs + DAY_MS),
    })
    return true
  })
}

async function underLimits(db, email, now) {
  // Global first: a flood stops before it costs any per-address bookkeeping.
  if (
    !(await takeThrottle(db, { key: ['global'], limit: GLOBAL_PER_HOUR, windowMs: HOUR_MS, now }))
  )
    return 'global'
  const address = email.toLowerCase()
  if (
    !(await takeThrottle(db, {
      key: ['address', address],
      limit: PER_ADDRESS_PER_DAY,
      windowMs: DAY_MS,
      now,
    }))
  )
    return 'address'
  return ''
}

function throttled(reason) {
  const err = new Error(`registration mail throttled (${reason})`)
  err.code = 'mail/throttled'
  return err
}

// ── Delivery ────────────────────────────────────────────────────────────────

/**
 * The founder's acknowledgement and the operators' alert for one new
 * provisioning request. `operators` is [{ uid, email }], already resolved.
 * Every send is claimed under provisioningRequests/{id}/notifications first,
 * keyed without the event id, so a retried trigger cannot mail twice.
 */
export async function deliverProvisioningMail({
  db,
  requestId,
  request,
  operators = [],
  mailer,
  logger,
  now = () => new Date(),
}) {
  const log = logger || noopLogger()
  const result = { founder: 'skipped', operators: 0 }
  if (!request || request.status !== 'requested') return result

  const missing = describeMailGap(mailer?.config)
  if (missing.length) {
    // Not claimed: the claim would suppress the mail once SMTP is set.
    log.error('registration mail is not configured', { requestId, missing })
    return { ...result, reason: 'not-configured' }
  }
  const appOrigin = mailer.config.appOrigin
  const ledger = (key) =>
    db.doc(`provisioningRequests/${requestId}/notifications/${notificationId(key)}`)

  const contact = mailboxAddress(request.contactEmail)
  if (contact) {
    const message = renderRequestReceivedMail(request, { requestId })
    const key = ['provisioning.received', requestId]
    const outcome = await sendOnce({
      ref: ledger(key),
      kind: 'provisioning.received',
      key,
      uid: '',
      subject: message.subject,
      now: now(),
      send: async () => {
        const over = await underLimits(db, contact, now())
        if (over) throw throttled(over)
        await mailer.send({ to: contact, ...message })
      },
    })
    result.founder = outcome.status
    if (outcome.status === 'failed') {
      log.error('registration acknowledgement not sent', {
        requestId,
        reason: outcome.error?.code === 'mail/throttled' ? outcome.error.message : outcome.reason,
      })
    }
  }

  const alert = renderOperatorAlertMail(request, { requestId, appOrigin })
  const seen = new Set()
  for (const op of operators.slice(0, MAX_OPERATORS)) {
    const to = mailboxAddress(op?.email)
    if (!to || seen.has(to.toLowerCase())) continue
    seen.add(to.toLowerCase())
    const key = ['provisioning.operator', requestId, String(op.uid || '')]
    const outcome = await sendOnce({
      ref: ledger(key),
      kind: 'provisioning.operator',
      key,
      uid: String(op.uid || ''),
      subject: alert.subject,
      now: now(),
      send: async () => {
        // Operators are trusted inboxes; only the global cap applies, so a
        // flood of requests does not also flood them.
        const ok = await takeThrottle(db, {
          key: ['operator'],
          limit: GLOBAL_PER_HOUR,
          windowMs: HOUR_MS,
          now: now(),
        })
        if (!ok) throw throttled('operator')
        await mailer.send({ to, ...alert })
      },
    })
    if (outcome.status === 'sent') result.operators += 1
  }
  return result
}

/**
 * Welcome the founder of an organization created on the WEEHS database.
 * `founderEmail` is their Firebase Auth address, resolved by the caller.
 * Orgs created by provisioning (own stack) are not this path.
 */
export async function deliverWelcomeMail({
  db,
  orgId,
  org,
  founderEmail,
  founderName = '',
  mailer,
  logger,
  now = () => new Date(),
}) {
  const log = logger || noopLogger()
  if (!org || typeof org !== 'object') return { status: 'skipped', reason: 'no-org' }
  const uid = typeof org.createdBy === 'string' ? org.createdBy : ''
  if (!uid || uid === 'provisioning' || org.stack === 'own')
    return { status: 'skipped', reason: 'not-weehs' }
  const to = mailboxAddress(founderEmail)
  if (!to) return { status: 'skipped', reason: 'no-email' }

  const missing = describeMailGap(mailer?.config)
  if (missing.length) {
    log.error('welcome mail is not configured', { orgId, missing })
    return { status: 'skipped', reason: 'not-configured' }
  }
  const message = renderWelcomeMail(
    { orgName: org.name, name: founderName },
    { appOrigin: mailer.config.appOrigin }
  )
  const key = ['org.welcome', orgId, uid]
  const outcome = await sendOnce({
    ref: db.doc(`organizations/${orgId}/notifications/${notificationId(key)}`),
    kind: 'org.welcome',
    key,
    uid,
    subject: message.subject,
    now: now(),
    send: () => mailer.send({ to, ...message }),
  })
  if (outcome.status === 'failed') {
    log.error('welcome mail not sent', { orgId, reason: outcome.reason })
  }
  return outcome
}
