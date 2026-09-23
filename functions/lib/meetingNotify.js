// Mail site-scoped admins when a committee meeting's minutes are saved.
//
// organizations/{orgId}/consultations/{id} has no draft flag. The form saves
// the whole record, and a later visit edits action status on the same
// document. Mailing every update would send a copy each time someone ticks
// an action closed.
//
// The durable event is the minutes field becoming non-empty. A create that
// already contains minutes is that event. A create with an empty minutes
// box is not — the meeting may not have been written up yet. The following
// write that stores the minutes is the one mail. A further edit, minutes
// already present, is not.
//
// Subject, minutes, attendees and action text are sealed, and they are the
// fields that name people (src/shared/crypto/policy.js). The mail may carry
// the subject only when it is still plaintext. Minutes, the attendee list
// and action rows are never copied, plaintext or not. Type, date and siteId
// stay readable. A meeting with no site is org-wide: only org admins.
import { scopeFrom, selectScopedAudience, loadOrgUsers, loadDoc } from './audience.js'
import { circulate } from './circulate.js'
import { describeMailGap } from './mailer.js'
import { loadReportAttachments } from './mailAttachments.js'
import { meetingMinutesPdf } from './reportAttachments.js'
import { renderMeetingMail } from './mailTemplates/lifecycle.js'

function hasMinutes(data) {
  return typeof data?.minutes === 'string' && data.minutes.trim().length > 0
}

/** The write on which minutes first appear, or null. */
export function planMeeting(before, after) {
  if (!after || after.deletedAt) return null
  if (!hasMinutes(after) || hasMinutes(before)) return null
  return {
    subject: after.subject,
    type: after.type,
    date: after.date,
    time: after.time,
    docId: after.docId,
    siteId: after.siteId,
    orgWide: !after.siteId,
  }
}

export async function deliverMeetingMail({
  db,
  orgId,
  docId,
  before,
  after,
  mailer,
  logger,
  now,
  users: usersIn,
}) {
  const meeting = planMeeting(before, after)
  if (!meeting) return { sent: 0, skipped: 0, failed: 0 }

  let site = null
  if (meeting.siteId) site = await loadDoc(db, `organizations/${orgId}/sites/${meeting.siteId}`)
  const scope = scopeFrom({ siteId: meeting.siteId }, site)
  const users = usersIn || (await loadOrgUsers(db, orgId))
  const recipients = selectScopedAudience(users, orgId, scope)
  const origin = mailer?.config?.appOrigin || ''
  const message = renderMeetingMail(
    {
      ...meeting,
      siteName: scope.siteName,
      region: scope.region,
      entity: scope.entity,
    },
    { appOrigin: origin }
  )

  // Minutes stay out of the body even when they are plaintext. They belong in
  // the MOM attachment, and only when readableText can still see them.
  let attachments = []
  if (recipients.length && describeMailGap(mailer?.config).length === 0) {
    attachments = await loadReportAttachments(
      () => [meetingMinutesPdf(after, { ...scope, orgWide: meeting.orgWide })],
      logger,
      { orgId, docId, kind: 'meeting.recorded' }
    )
  }

  return circulate({
    db,
    orgId,
    recipients,
    kind: 'meeting.recorded',
    keyFor: (recipient) => ['meeting.recorded', orgId, docId, recipient.uid],
    messageFor: () => message,
    mailer,
    logger,
    now,
    logLabel: 'meeting',
    context: { docId },
    attachments,
  })
}
