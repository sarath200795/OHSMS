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
// Recipients are everyone whose grants reach the incident's site, entity or
// region. Org `role === 'admin'` reaches every scope, including a report
// that names no place. A manager or a member is included only when a
// posting or an access grant actually reaches that place. An empty-string
// grant matches nothing. createIncident writes the reporter's uid to
// createdBy. They are included even when their grants miss and even when
// they are the actor. Pending, suspended, another org, or not an email is
// still not a mailbox. One shared mailbox is one send. The cap keeps the
// reporter's copy.
// ─────────────────────────────────────────────────────────────────────────────
import { scopeFrom, selectScopedAudience, addressForToken, unionAddresses } from './audience.js'
import { notificationId, sendOnce } from './notify.js'
import { loadOrgDisplayName } from './mailBrand.js'
import { describeMailGap } from './mailer.js'
import { loadReportAttachments } from './mailAttachments.js'
import { loadAppReportAttachment } from './reportAttachments.js'
import { renderIncidentReportedMail } from './mailTemplates/incidentReported.js'
import { sendPaced } from './mailPace.js'

export const MAX_REPORT_MAILS = 100

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function byUid(a, b) {
  return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0
}

/**
 * The reporter's mailbox stays inside the cap. Dedupe may already have kept
 * another profile on the same address; that row is the reporter's copy and
 * is what has to survive. Overflow stays the count of people not sent.
 */
function keepReporter(uniquePeople, reporter, reporterEmail) {
  const list = uniquePeople.slice(0, MAX_REPORT_MAILS)
  const overflow = Math.max(0, uniquePeople.length - list.length)
  const email = typeof reporterEmail === 'string' ? reporterEmail.toLowerCase() : ''
  const already =
    list.some((person) => person.uid === reporter) ||
    (email && list.some((person) => person.email.toLowerCase() === email))
  if (!reporter || already) return { list, overflow }
  const held = uniquePeople.find(
    (person) => person.uid === reporter || (email && person.email.toLowerCase() === email)
  )
  if (!held) return { list, overflow }
  const room = list.slice(0, Math.max(0, MAX_REPORT_MAILS - 1))
  return { list: [...room, held].sort(byUid), overflow }
}

/**
 * One address per person. Duplicate profiles and two uids sharing a mailbox
 * collapse, so a reporter who also holds a grant is not mailed twice.
 * Order is the uid, so a retry that stops halfway resumes the same list.
 *
 * `reporterUid` is createdBy. They are included even when their grants miss
 * the incident. A missing address still drops them.
 */
export function selectRecipients(users, { orgId, scope, reporterUid } = {}) {
  const reporter = clean(reporterUid)
  const reporterAddr = addressForToken(users, orgId, reporter)
  const rows = unionAddresses(selectScopedAudience(users, orgId, scope || {}), [reporterAddr])
  return keepReporter(rows, reporter, reporterAddr?.email)
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
  readObject,
  sleep,
  gapMs,
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
  const scope = scopeFrom(
    {
      siteId: after?.siteId,
      region: after?.region,
      entity: after?.entity,
      site: after?.site,
    },
    site ? { id: siteId, ...site } : null
  )
  const recipients = selectRecipients(users, {
    orgId,
    scope,
    reporterUid: after?.createdBy,
  })

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
    sender: await loadOrgDisplayName(db, orgId),
  })

  // Before any claim. The file is the initial-report PDF the app uploaded on
  // this write. If it is missing, the body still goes and the row is 'sent',
  // not 'failed' — a failed claim would suppress the retry of a mail that
  // never left.
  const attachments = await loadReportAttachments(
    () =>
      loadAppReportAttachment({
        orgId,
        record: after,
        readObject,
        prefix: 'Incident-Report',
        ref: after?.refNo || docId,
        logger: log,
        context: { orgId, docId, kind: 'incident.reported' },
      }),
    log,
    { orgId, docId, kind: 'incident.reported' }
  )

  let sent = 0
  let skipped = recipients.overflow
  let failed = 0

  for (let i = 0; i < recipients.list.length; i += 1) {
    const person = recipients.list[i]
    const key = ['incident.reported', orgId, docId, person.uid]
    const ref = db.doc(`organizations/${orgId}/notifications/${notificationId(key)}`)
    const attempt = () =>
      sendOnce({
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
            attachments,
            senderName: message.senderName,
          }),
      })
    const paced = await sendPaced({ attempt, sleep, gapMs, first: i === 0 })
    const result = paced.result

    if (result.status === 'sent') {
      sent += 1
      log.info('incident report mail sent', { orgId, docId, uid: person.uid })
    } else if (result.status === 'failed') {
      failed += 1
      log.error('incident report mail failed', {
        orgId,
        docId,
        uid: person.uid,
        reason: result.reason,
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
    if (paced.stop) {
      skipped += recipients.list.length - i - 1
      return { sent, skipped, failed, reason: 'rate-limited' }
    }
  }

  return { sent, skipped, failed }
}
