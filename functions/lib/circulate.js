// One fan-out for every lifecycle mail that is not an assignment.
//
// The ledger rule is the same as assignment mail: claim
// organizations/{orgId}/notifications/{id} before the send, and do not put
// the Cloud Functions event id in the key. A retry of the same write has a
// new event id; including it is how the same permit approval was mailed twice
// the first time this was sketched against the assignment helper.
//
// A missing SMTP password does not claim. The claim is what would suppress
// the mail after the operator sets the password, and the original write will
// not be delivered again.
import { notificationId, sendOnce } from './notify.js'
import { describeMailGap } from './mailer.js'
import { CIRCULATION_CAP } from './audience.js'
import { sendPaced } from './mailPace.js'

function noopLogger() {
  return { info() {}, error() {} }
}

/**
 * @param recipients [{ uid, email, ...extra }]
 * @param keyFor (recipient) => string[]  stable identity, no event id
 * @param messageFor (recipient) => { subject, text, html }
 * @param attachments already-resolved files. Built by the caller BEFORE this
 *   function claims the ledger. A missing report must not throw inside send:
 *   sendOnce would mark the row failed, and the retry is required to skip, so
 *   the body mail would never leave.
 */
export async function circulate({
  db,
  orgId,
  recipients,
  kind,
  keyFor,
  messageFor,
  mailer,
  logger,
  now = () => new Date(),
  cap = CIRCULATION_CAP,
  logLabel = 'circulation',
  context = {},
  attachments = [],
  sleep,
  gapMs,
}) {
  const log = logger || noopLogger()
  const list = Array.isArray(recipients) ? recipients : []
  if (!list.length) return { sent: 0, skipped: 0, failed: 0 }

  const missing = describeMailGap(mailer?.config)
  if (missing.length) {
    log.error(`${logLabel} mail is not configured`, {
      orgId,
      ...context,
      missing,
      count: list.length,
    })
    return { sent: 0, skipped: list.length, failed: 0, reason: 'not-configured' }
  }

  const batch = list.slice(0, cap)
  if (list.length > batch.length) {
    log.error(`${logLabel} mail capped`, {
      orgId,
      ...context,
      count: list.length,
      cap,
    })
  }

  let sent = 0
  let skipped = list.length - batch.length
  let failed = 0

  // One socket at a time, with a gap. A Promise.all of the cap would open a
  // hundred SMTP sessions inside a single function invocation, and back-to-back
  // sends are how Private Email answers 554 too many messages.
  for (let i = 0; i < batch.length; i += 1) {
    const recipient = batch[i]
    const message = messageFor(recipient)
    const key = keyFor(recipient)
    const ref = db.doc(`organizations/${orgId}/notifications/${notificationId(key)}`)
    const attempt = () =>
      sendOnce({
        ref,
        kind,
        key,
        uid: recipient.uid,
        subject: message.subject,
        now: now(),
        send: () =>
          mailer.send({
            to: recipient.email,
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
      log.info(`${logLabel} mail sent`, { orgId, ...context, kind, uid: recipient.uid })
    } else if (result.status === 'failed') {
      failed += 1
      log.error(`${logLabel} mail failed`, {
        orgId,
        ...context,
        kind,
        uid: recipient.uid,
        reason: result.reason,
        error: result.error?.message || 'send-failed',
      })
    } else {
      skipped += 1
      log.info(`${logLabel} mail skipped`, {
        orgId,
        ...context,
        kind,
        uid: recipient.uid,
        reason: result.reason,
      })
    }
    if (paced.stop) {
      // The rest are not claimed. A later delivery can send them. Claiming
      // them as failed is how a rate limit used to silence the whole list.
      skipped += batch.length - i - 1
      return { sent, skipped, failed, reason: 'rate-limited' }
    }
  }

  return { sent, skipped, failed }
}
