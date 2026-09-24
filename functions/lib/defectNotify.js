// Mail site-scoped admins when a fire extinguisher, AED or fire-alarm defect
// becomes known.
//
// Two writes carry that fact, and they are not the same moment:
//
//   organizations/{orgId}/reports/{id}
//     kind: 'defect'         an extinguisher fault (defectType is a key)
//     kind: 'asset_defect'   AED (assetKind 'aed') or FAS (assetKind 'fas')
//     Created pending. Approval later mutates the asset. The report is the
//     "someone reported this" event, so it is what gets mailed.
//
//   The asset document itself, on a later write that newly shows the fault:
//     extinguishers.physicalDefects   a key that was not there before
//     aeds.status                      becomes 'out_of_service'
//     fas.status                       becomes 'faulty'
//
// Approving a report does both: the report already mailed, and the asset
// write would mail again. The asset path looks for a non-rejected report for
// that asset and defect and stays quiet when it finds one. A fault typed
// straight onto the asset — no report — still mails. A spreadsheet insert
// that arrives already defective does not: before is null, and a bulk import
// of the existing fleet is not a new report.
//
// Stretcher reports and extinguisher status-change requests are not defects
// of the three kinds this covers.
//
// The audience is selectScopedAudience: org admins, plus any approved member
// whose posting or access grant reaches the asset's site, region or entity.
// Not every org member.
import { scopeFrom, selectScopedAudience, loadOrgUsers, loadDoc } from './audience.js'
import { loadOrgDisplayName } from './mailBrand.js'
import { circulate } from './circulate.js'
import { renderDefectMail } from './mailTemplates/lifecycle.js'
import { readableText } from './mailTemplates/safe.js'

// The six keys in src/modules/fire/lib/constants.js DEFECTS. An unknown key
// is shown as stored, after readableText, rather than invented.
const EXTINGUISHER_DEFECT_LABEL = {
  pin: 'PIN',
  stand: 'Stand',
  hose_pipe: 'Hose pipe damage',
  handle: 'Handle damage',
  empty: 'Empty',
  over_pressurized: 'Over pressurized',
}

const ASSET_COLLECTION = {
  extinguisher: 'extinguishers',
  aed: 'aeds',
  fas: 'fas',
}

function text(value) {
  return readableText(value)
}

export function extinguisherDefectLabel(key) {
  const known = EXTINGUISHER_DEFECT_LABEL[key]
  if (known) return known
  return text(key)
}

/**
 * A new report that is a defect on an extinguisher, AED or FAS.
 * Updates (approval, rejection) are not a second report.
 */
export function planDefectReport(before, after) {
  if (before || !after || after.deletedAt) return null
  if (after.kind === 'defect' && text(after.defectType)) {
    return {
      source: 'report',
      assetKind: 'extinguisher',
      assetId: text(after.extId),
      defectKey: text(after.defectType),
      summary: extinguisherDefectLabel(after.defectType),
      note: after.note,
      label: after.extLabel,
      path: '/equipment/approvals',
      headline: 'A fire extinguisher defect was reported.',
    }
  }
  if (after.kind === 'asset_defect' && (after.assetKind === 'aed' || after.assetKind === 'fas')) {
    return {
      source: 'report',
      assetKind: after.assetKind,
      assetId: text(after.assetRefId),
      defectKey: text(after.defect) || 'defect',
      summary: after.defect || (after.assetKind === 'aed' ? 'AED defect' : 'Fire alarm defect'),
      note: after.note,
      label: after.assetLabel,
      path: '/equipment/approvals',
      headline:
        after.assetKind === 'aed'
          ? 'An AED defect was reported.'
          : 'A fire alarm defect was reported.',
    }
  }
  return null
}

/** Stable across a retry of the same write, different when the fault returns later. */
export function writeStamp(data) {
  const u = data?.updatedAt ?? data?.lastActionAt
  if (!u) return ''
  if (typeof u === 'string') return u
  if (typeof u.toMillis === 'function') return String(u.toMillis())
  if (typeof u.seconds === 'number') return String(u.seconds)
  if (u instanceof Date) return String(u.getTime())
  return ''
}

/**
 * Faults that appeared on an existing asset. Creates are skipped: a bulk
 * import of units that already carry defects is not a report.
 */
export function planAssetDefects(collection, before, after, docId) {
  if (!before || !after || after.deletedAt || before.deletedAt) return []
  const assetId = docId || text(after.id)
  if (!assetId) return []
  const stamp = writeStamp(after)

  if (collection === 'extinguishers') {
    const prev = new Set(Array.isArray(before.physicalDefects) ? before.physicalDefects : [])
    const next = Array.isArray(after.physicalDefects) ? after.physicalDefects : []
    return next
      .filter((key) => key && !prev.has(key))
      .map((key) => ({
        source: 'asset',
        assetKind: 'extinguisher',
        assetId,
        defectKey: String(key),
        summary: extinguisherDefectLabel(key),
        note: '',
        label: after.serialNo || '',
        stamp,
        path: '/equipment/physical-defects',
        headline: 'A fire extinguisher is now showing an open defect.',
      }))
  }

  if (
    collection === 'aeds' &&
    before.status !== 'out_of_service' &&
    after.status === 'out_of_service'
  ) {
    return [
      {
        source: 'asset',
        assetKind: 'aed',
        assetId,
        defectKey: 'out_of_service',
        summary: 'Out of service',
        note: '',
        label: after.assetId || '',
        stamp,
        path: '/equipment/aed',
        headline: 'An AED was marked out of service.',
      },
    ]
  }

  if (collection === 'fas' && before.status !== 'faulty' && after.status === 'faulty') {
    return [
      {
        source: 'asset',
        assetKind: 'fas',
        assetId,
        defectKey: 'faulty',
        summary: 'Faulty',
        note: '',
        label: after.deviceId || after.deviceType || '',
        stamp,
        path: '/equipment/fas',
        headline: 'A fire alarm device was marked faulty.',
      },
    ]
  }

  return []
}

/**
 * True when a report already owns this fault, so the asset write is the
 * approval (or a repeat) and must not send a second mail.
 * A rejected report does not count: the fault was refused, and a later
 * direct edit is news again only if no other open report covers it.
 */
export function reportCoversAssetDefect(reports, plan) {
  for (const report of reports || []) {
    if (!report || report.approvalStatus === 'rejected' || report.deletedAt) continue
    if (plan.assetKind === 'extinguisher') {
      if (
        report.kind === 'defect' &&
        report.extId === plan.assetId &&
        report.defectType === plan.defectKey
      ) {
        return true
      }
    } else if (
      report.kind === 'asset_defect' &&
      report.assetKind === plan.assetKind &&
      report.assetRefId === plan.assetId
    ) {
      return true
    }
  }
  return false
}

async function loadReports(db, orgId, plan) {
  const col = db.collection(`organizations/${orgId}/reports`)
  const field = plan.assetKind === 'extinguisher' ? 'extId' : 'assetRefId'
  const snap = await col.where(field, '==', plan.assetId).get()
  return snap.docs.map((d) => d.data() || {})
}

function assetRef(asset, plan) {
  if (plan.assetKind === 'extinguisher')
    return text(asset?.serialNo) || text(plan.label) || plan.assetId
  if (plan.assetKind === 'aed') return text(asset?.assetId) || text(plan.label) || plan.assetId
  return text(asset?.deviceId) || text(asset?.deviceType) || text(plan.label) || plan.assetId
}

async function scopeForAsset(db, orgId, plan, assetIn) {
  const collection = ASSET_COLLECTION[plan.assetKind]
  const asset =
    assetIn ||
    (plan.assetId && collection
      ? await loadDoc(db, `organizations/${orgId}/${collection}/${plan.assetId}`)
      : null)
  let site = null
  const siteId = text(asset?.siteId)
  if (siteId && !siteId.includes('/') && (!text(asset?.region) || !text(asset?.entity))) {
    site = await loadDoc(db, `organizations/${orgId}/sites/${siteId}`)
  }
  const scope = scopeFrom(asset || {}, site)
  return { scope, ref: assetRef(asset, plan) }
}

async function mailPlans({
  db,
  orgId,
  plans,
  mailer,
  logger,
  now,
  users: usersIn,
  docId,
  kind,
  keyFor,
}) {
  if (!plans.length) return { sent: 0, skipped: 0, failed: 0 }
  const users = usersIn || (await loadOrgUsers(db, orgId))
  const origin = mailer?.config?.appOrigin || ''
  const flat = []
  for (const plan of plans) {
    const { scope, ref } = await scopeForAsset(db, orgId, plan)
    const audience = selectScopedAudience(users, orgId, scope)
    for (const recipient of audience) {
      flat.push({
        ...recipient,
        detail: {
          ...plan,
          ref,
          siteName: scope.siteName,
          region: scope.region,
          entity: scope.entity,
        },
      })
    }
  }
  const sender = flat.length ? await loadOrgDisplayName(db, orgId) : ''
  return circulate({
    db,
    orgId,
    recipients: flat,
    kind,
    keyFor,
    messageFor: (recipient) => renderDefectMail(recipient.detail, { appOrigin: origin, sender }),
    mailer,
    logger,
    now,
    logLabel: 'defect',
    context: { docId },
  })
}

export async function deliverDefectReport({
  db,
  orgId,
  docId,
  before,
  after,
  mailer,
  logger,
  now,
  users,
}) {
  const plan = planDefectReport(before, after)
  if (!plan) return { sent: 0, skipped: 0, failed: 0 }
  return mailPlans({
    db,
    orgId,
    docId,
    plans: [plan],
    mailer,
    logger,
    now,
    users,
    kind: 'defect.reported',
    keyFor: (recipient) => ['defect.reported', orgId, docId, recipient.uid],
  })
}

export async function deliverAssetDefects({
  db,
  orgId,
  docId,
  collection,
  before,
  after,
  mailer,
  logger,
  now,
  users,
  reports: reportsIn,
}) {
  const planned = planAssetDefects(collection, before, after, docId)
  if (!planned.length) return { sent: 0, skipped: 0, failed: 0 }
  const open = []
  for (const plan of planned) {
    let reports = reportsIn
    if (!reports) {
      try {
        reports = await loadReports(db, orgId, plan)
      } catch (err) {
        // A missed suppression can send a second copy of a report that
        // already mailed. A swallowed fault sends nothing, which is worse
        // for a defect nobody filed a report for. Send, and say so.
        logger?.error?.('defect report lookup failed', {
          orgId,
          docId,
          error: err?.message || String(err),
        })
        reports = []
      }
    }
    if (!reportCoversAssetDefect(reports, plan)) open.push(plan)
  }
  return mailPlans({
    db,
    orgId,
    docId,
    plans: open,
    mailer,
    logger,
    now,
    users,
    kind: 'defect.opened',
    keyFor: (recipient) => [
      'defect.opened',
      orgId,
      recipient.detail.assetKind,
      recipient.detail.assetId,
      recipient.detail.defectKey,
      recipient.detail.stamp || '',
      recipient.uid,
    ],
  })
}
