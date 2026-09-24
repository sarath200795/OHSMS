// Mail site-scoped admins when a mock drill report is saved.
//
// addMockDrill writes the document once, after the evidence photos, and the
// form will not save a future date. That create is the report. A later edit
// is not a second circulation. CAPA assignment mail already runs on the same
// write, with its own ledger kind; this does not touch those keys.
//
// Commander names, the debrief and the action text are sealed when encryption
// is on, and they name people even when they are not. They are not copied
// into the body. The attachment is the print PDF the app uploaded; that file
// is the report the saver was looking at, and storage.rules keep clients from
// reading it back. Scenario, event type, date, outcome and score stay
// readable on purpose (src/shared/crypto/policy.js) and are the lines the
// body is allowed to carry.
import { scopeFrom, selectScopedAudience, loadOrgUsers, loadDoc } from './audience.js'
import { loadOrgDisplayName } from './mailBrand.js'
import { circulate } from './circulate.js'
import { describeMailGap } from './mailer.js'
import { loadReportAttachments } from './mailAttachments.js'
import { loadAppReportAttachment } from './reportAttachments.js'
import { renderDrillReportMail } from './mailTemplates/lifecycle.js'

export function planDrillReport(before, after) {
  if (before || !after || after.deletedAt) return null
  const score = after.score
  const scoreLabel =
    typeof score === 'number' && Number.isFinite(score)
      ? `${score}%`
      : typeof score === 'string'
        ? score
        : ''
  return {
    scenario: after.scenario,
    eventType: after.eventType,
    date: after.date,
    time: after.time,
    outcome: after.outcome,
    scoreLabel,
    docId: after.docId,
    siteId: after.siteId,
    region: after.region,
    entity: after.entity,
    centerName: after.centerName,
  }
}

export async function deliverDrillReport({
  db,
  orgId,
  docId,
  before,
  after,
  mailer,
  logger,
  now,
  users: usersIn,
  readObject,
}) {
  const drill = planDrillReport(before, after)
  if (!drill) return { sent: 0, skipped: 0, failed: 0 }

  let site = null
  if (drill.siteId && (!drill.region || !drill.entity)) {
    site = await loadDoc(db, `organizations/${orgId}/sites/${drill.siteId}`)
  }
  const scope = scopeFrom(drill, site)
  const users = usersIn || (await loadOrgUsers(db, orgId))
  const recipients = selectScopedAudience(users, orgId, scope)
  const origin = mailer?.config?.appOrigin || ''
  const sender = recipients.length ? await loadOrgDisplayName(db, orgId) : ''
  const message = renderDrillReportMail(
    { ...drill, siteName: scope.siteName, region: scope.region, entity: scope.entity },
    { appOrigin: origin, sender }
  )

  // Resolved before circulate claims the ledger. The file is the PDF the app
  // uploaded for this save. A missing object skips the file and still sends
  // the body; it does not fail the claim.
  let attachments = []
  if (recipients.length && describeMailGap(mailer?.config).length === 0) {
    attachments = await loadReportAttachments(
      () =>
        loadAppReportAttachment({
          orgId,
          record: after,
          readObject,
          prefix: 'Mock-Drill-Report',
          ref: after?.docId,
          logger,
          context: { orgId, docId, kind: 'drill.reported' },
        }),
      logger,
      { orgId, docId, kind: 'drill.reported' }
    )
  }

  return circulate({
    db,
    orgId,
    recipients,
    kind: 'drill.reported',
    keyFor: (recipient) => ['drill.reported', orgId, docId, recipient.uid],
    messageFor: () => message,
    mailer,
    logger,
    now,
    logLabel: 'drill report',
    context: { docId },
    attachments,
  })
}
