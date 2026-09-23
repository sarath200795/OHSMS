// ─────────────────────────────────────────────────────────────────────────────
// Who hears that an incident was reported.
//
// The durable event is stagesDone.initial flipping to true. That is the
// wizard's "save initial report" (IncidentWizard.saveInitial): the create
// writes the draft with the flag false, and the next write sets it. A later
// edit of the same report leaves the flag true, so it is not a second
// report. Creating a document that is already reported — one write, flag
// true, no before — is the same event.
//
// 5 Why usually is not on the document yet. Investigation is a later step.
// The mail includes it when this write already carries it, and says it is
// not recorded otherwise. A follow-up edit that adds the diagram is not a
// new report, and must not send again.
//
// Recipients are the membership scope, not "every approved member". Incident
// reads in firestore.rules are org-wide, which would mail a plant's report to
// people at every other plant. Who may work a site is resolveAccessibleSites
// in src/shared/auth/access.js, and the same union the document rule calls
// reachesSite:
//
//   posting siteId, access.sites, access.regions, access.entities
//
// An admin reaches every site, so admins are included. A manager or auditor
// is not elevated here: the document library elevates them, the site grants
// do not. Empty strings are not a grant. A profile carrying '' in regions
// must not match every incident that has no region — the same guard the rule
// states. When the incident names a site but not its region, the site record
// fills the gap, because a region grant is access to that site.
//
// An incident that names no site, region or entity has nothing to match. Only
// admins receive it: they are the people the access model already treats as
// reaching every site.
// ─────────────────────────────────────────────────────────────────────────────
import { notificationId, sendOnce } from './notify.js'
import { describeMailGap } from './mailer.js'
import { renderIncidentReportedMail } from './mailTemplates/incidentReported.js'

export const MAX_REPORT_MAILS = 100

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function strings(value) {
  if (!Array.isArray(value)) return []
  return value.map(clean).filter(Boolean)
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

/** Site, region and entity the report is filed against. Blanks are not scope. */
export function incidentScope(incident, site) {
  const siteId = clean(incident?.siteId)
  const regions = unique([clean(incident?.region), clean(site?.region)])
  const entities = unique([clean(incident?.entity), clean(site?.entity)])
  return { siteId, regions, entities }
}

/**
 * True when this person's grants reach the report's site, region or entity.
 * Admins reach every site. No scope at all still includes admins — see the
 * file comment — and nobody else.
 */
export function userReachesScope(user, scope) {
  if (!user || typeof user !== 'object') return false
  if (user.role === 'admin') return true
  const hasScope =
    Boolean(scope?.siteId) || scope?.regions?.length > 0 || scope?.entities?.length > 0
  if (!hasScope) return false
  const access = user.access && typeof user.access === 'object' ? user.access : {}
  const sites = new Set(strings(access.sites))
  const posting = clean(user.siteId)
  if (posting) sites.add(posting)
  if (scope.siteId && sites.has(scope.siteId)) return true
  const regions = new Set(strings(access.regions))
  if (scope.regions.some((region) => regions.has(region))) return true
  const entities = new Set(strings(access.entities))
  if (scope.entities.some((entity) => entities.has(entity))) return true
  return false
}

function usableUid(uid) {
  return typeof uid === 'string' && uid !== '' && uid !== '.' && uid !== '..' && !uid.includes('/')
}

/** Profile checks shared with assignment mail: tenancy, approval, a real address. */
export function addressDecision(user, orgId) {
  if (!user || typeof user !== 'object') return { send: false, reason: 'no-user' }
  if (user.orgId !== orgId) return { send: false, reason: 'cross-tenant' }
  if (user.status && user.status !== 'approved') return { send: false, reason: 'not-approved' }
  const email = typeof user.email === 'string' ? user.email.trim() : ''
  if (!EMAIL_RE.test(email)) return { send: false, reason: 'no-email' }
  return { send: true, email }
}

/**
 * One address per person. Duplicate profiles and two uids sharing a mailbox
 * collapse, so the reporter is not mailed twice for also holding a site grant.
 * Order is the uid, so a retry that stops halfway resumes the same list.
 */
export function selectRecipients(users, { orgId, scope }) {
  const byUid = new Map()
  for (const user of users || []) {
    const uid = clean(user?.uid)
    if (!usableUid(uid) || byUid.has(uid)) continue
    if (!userReachesScope(user, scope)) continue
    const decision = addressDecision(user, orgId)
    if (!decision.send) continue
    byUid.set(uid, { uid, email: decision.email })
  }
  const ordered = [...byUid.values()].sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0))
  const seen = new Set()
  const uniquePeople = []
  for (const person of ordered) {
    const key = person.email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    uniquePeople.push(person)
  }
  return {
    list: uniquePeople.slice(0, MAX_REPORT_MAILS),
    overflow: Math.max(0, uniquePeople.length - MAX_REPORT_MAILS),
  }
}

/** The initial report has just been saved, and the incident is still live. */
export function isFreshReport(before, after) {
  if (!after || after.deletedAt) return false
  const wasReported = before?.stagesDone?.initial === true
  const isReported = after?.stagesDone?.initial === true
  return isReported && !wasReported
}

function snapshotExists(snap) {
  if (!snap) return false
  return typeof snap.exists === 'function' ? Boolean(snap.exists()) : Boolean(snap.exists)
}

function safeDocId(id) {
  const trimmed = clean(id)
  if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed.includes('/')) return ''
  return trimmed
}

function noopLogger() {
  return { info() {}, error() {} }
}

/**
 * Circulate one report. Never throws for a mail failure or a missing
 * provider — the incident write has already committed. A missing provider
 * does not claim the ledger, for the same reason assignment mail does not:
 * the claim is what suppresses a later send, and this event will not be
 * re-delivered after SMTP is configured.
 *
 * The ledger key is the incident and the recipient, not the function event
 * id. A retry of this event and a second delivery of the same report both
 * find the claim.
 */
export async function deliverIncidentReport({
  db,
  orgId,
  docId,
  before,
  after,
  mailer,
  logger,
  now = () => new Date(),
}) {
  const log = logger || noopLogger()
  if (!isFreshReport(before, after))
    return { sent: 0, skipped: 0, failed: 0, reason: 'not-a-report' }

  const missing = describeMailGap(mailer?.config)
  if (missing.length) {
    log.error('incident report mail is not configured', { orgId, docId, missing })
    return { sent: 0, skipped: 0, failed: 0, reason: 'not-configured' }
  }

  let site = null
  const siteId = safeDocId(after.siteId)
  if (siteId) {
    const siteSnap = await db.doc(`organizations/${orgId}/sites/${siteId}`).get()
    site = snapshotExists(siteSnap) ? siteSnap.data() : null
  }

  const usersSnap = await db.collection('users').where('orgId', '==', orgId).get()
  const users = usersSnap.docs.map((docSnap) => ({ uid: docSnap.id, ...(docSnap.data() || {}) }))
  const scope = incidentScope(after, site)
  const recipients = selectRecipients(users, { orgId, scope })

  if (recipients.overflow) {
    log.error('incident report mail capped', {
      orgId,
      docId,
      count: recipients.list.length + recipients.overflow,
      cap: MAX_REPORT_MAILS,
    })
  }

  if (!recipients.list.length) {
    log.info('incident report mail skipped', { orgId, docId, reason: 'no-recipients' })
    return { sent: 0, skipped: recipients.overflow, failed: 0, reason: 'no-recipients' }
  }

  const message = renderIncidentReportedMail(after, {
    docId,
    appOrigin: mailer.config.appOrigin,
    site,
  })

  let sent = 0
  let skipped = recipients.overflow
  let failed = 0

  for (const person of recipients.list) {
    const key = ['incident.reported', orgId, docId, person.uid]
    const ref = db.doc(`organizations/${orgId}/notifications/${notificationId(key)}`)
    const result = await sendOnce({
      ref,
      kind: 'incident.reported',
      key,
      uid: person.uid,
      subject: message.subject,
      now: now(),
      send: () =>
        mailer.send({
          to: person.email,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
    })

    if (result.status === 'sent') {
      sent += 1
      log.info('incident report mail sent', { orgId, docId, uid: person.uid })
    } else if (result.status === 'failed') {
      failed += 1
      log.error('incident report mail failed', {
        orgId,
        docId,
        uid: person.uid,
        error: result.error?.message || 'send-failed',
      })
    } else {
      skipped += 1
      log.info('incident report mail skipped', {
        orgId,
        docId,
        uid: person.uid,
        reason: result.reason,
      })
    }
  }

  return { sent, skipped, failed }
}
