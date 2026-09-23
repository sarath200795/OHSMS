// Mail the people a permit to work actually names, when its lifecycle moves.
//
// The document is organizations/{orgId}/permits/{id}. Status on screen is
// derived (src/modules/ptw/lib/permitStatus.js); what is stored, and what this
// trigger can see change, is the decision blocks:
//
//   engineering / operations          approve or reject the permit
//   closure                           requested, then each team decides
//   extension                         same shape as closure
//   closedDueToObservation            unsafe observation closed it
//
// Create is the submit. There is no later "submit draft" write.
//
// Who has a uid:
//   createdBy                         the person who raised it
//   assignedEngineer / assignedOperator
//   *.by / closure.requestedBy / extension.requestedBy
//
// Who does not: participants, the receiver (issuedToName / issuedToPhone),
// fire watchers and the confined-space watcher are display names and a phone.
// Matching those names against the directory would cross people who share
// one, which is why assignment mail refuses to. A phone number is not an
// address. They are not mailed.
//
// When a team has no named approver, the form says the permit routes to the
// whole team. In this app that team is role admin, manager, engineering or
// operations (src/modules/ptw/context/AuthContext.jsx maps manager → the
// permit admin). Those people are included only when their grants reach the
// permit's site. Members and auditors are not approvers. If the site name
// matches more than one site, or none, the unassigned-team mail goes to org
// admins only — a guess must not fan out to every manager.
import { safePathSegment } from './assignmentNotify.js'
import {
  scopeFrom,
  reachesScope,
  recipientAddress,
  dedupeByEmail,
  loadOrgUsers,
} from './audience.js'
import { circulate } from './circulate.js'
import { describeMailGap } from './mailer.js'
import { loadReportAttachments } from './mailAttachments.js'
import { permitMailAttachments } from './reportAttachments.js'
import { renderPermitMail } from './mailTemplates/lifecycle.js'
import { readableText } from './mailTemplates/safe.js'

export const PERMIT_APPROVER_ROLES = ['admin', 'manager', 'engineering', 'operations']

const TEAMS = ['engineering', 'operations']

const COPY = {
  raised: {
    subjectLead: 'Permit raised',
    headline: 'A permit to work was raised and is waiting for approval.',
    status: 'Waiting for approval',
  },
  approved: {
    subjectLead: 'Permit approval',
    headline: 'One team approved a permit to work. The other team has not yet.',
    status: 'Part-approved',
  },
  rejected: {
    subjectLead: 'Permit rejected',
    headline: 'A permit to work was rejected.',
    status: 'Rejected',
  },
  issued: {
    subjectLead: 'Permit issued',
    headline: 'Both teams approved a permit to work. Work may proceed.',
    status: 'Approved — work may proceed',
  },
  closure_requested: {
    subjectLead: 'Permit closure requested',
    headline: 'Closure was requested on a permit to work.',
    status: 'Closure requested',
  },
  closure_rejected: {
    subjectLead: 'Permit closure rejected',
    headline: 'A closure request on a permit to work was rejected.',
    status: 'Closure rejected',
  },
  closed: {
    subjectLead: 'Permit closed',
    headline: 'A permit to work was closed.',
    status: 'Closed',
  },
  extension_requested: {
    subjectLead: 'Permit extension requested',
    headline: 'An extension was requested on a permit to work.',
    status: 'Extension requested',
  },
  extension_rejected: {
    subjectLead: 'Permit extension rejected',
    headline: 'An extension request on a permit to work was rejected.',
    status: 'Extension rejected',
  },
  extended: {
    subjectLead: 'Permit extended',
    headline: 'An extension was approved on a permit to work.',
    status: 'Extended',
  },
  closed_noncompliance: {
    subjectLead: 'Permit closed for non-compliance',
    headline: 'A permit to work was closed after an unsafe observation.',
    status: 'Closed — non-compliance',
  },
}

function uid(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function statusOf(permit, team) {
  return permit?.[team]?.status || ''
}

function bothApproved(permit) {
  return (
    statusOf(permit, 'engineering') === 'approved' && statusOf(permit, 'operations') === 'approved'
  )
}

function blockDone(block) {
  return Boolean(
    block && block.engineering?.status === 'approved' && block.operations?.status === 'approved'
  )
}

function assigneeFor(permit, team) {
  return uid(team === 'engineering' ? permit?.assignedEngineer : permit?.assignedOperator)
}

function unassignedTeams(permit) {
  return TEAMS.filter((team) => !assigneeFor(permit, team))
}

function teamLabel(team) {
  if (team === 'engineering') return 'Engineering'
  if (team === 'operations') return 'Operations'
  return ''
}

function makeEvent(name, fields) {
  return {
    name,
    actorUid: uid(fields.actorUid),
    token: fields.token,
    team: fields.team || '',
    needsTeam: Boolean(fields.needsTeam),
    ...COPY[name],
  }
}

function decisionEvents(
  before,
  after,
  blockName,
  requestedName,
  rejectedName,
  doneName,
  doneToken
) {
  const prev = before?.[blockName]
  const next = after?.[blockName]
  if (!prev && next) {
    const open = unassignedTeams(after)
    return [
      makeEvent(requestedName, {
        actorUid: next.requestedBy,
        token: `${requestedName}:${next.requestedAt || ''}`,
        needsTeam: open.length > 0,
      }),
    ]
  }
  if (!next) return []
  if (blockDone(next) && !blockDone(prev)) {
    const actorTeam = TEAMS.find(
      (team) => (prev?.[team]?.status || '') !== 'approved' && next[team]?.status === 'approved'
    )
    return [
      makeEvent(doneName, {
        actorUid: actorTeam ? next[actorTeam]?.by : '',
        token: doneToken,
      }),
    ]
  }
  const events = []
  for (const team of TEAMS) {
    const prevStatus = prev?.[team]?.status || ''
    const nextStatus = next[team]?.status || ''
    if (prevStatus === nextStatus || nextStatus !== 'rejected') continue
    events.push(
      makeEvent(rejectedName, {
        actorUid: next[team]?.by,
        token: `${rejectedName}:${team}:${next[team]?.at || ''}`,
        team,
      })
    )
  }
  return events
}

/**
 * Lifecycle transitions on this write. A storedStatus-only reconcile (the
 * client persisting an expiry it computed) changes no decision block and
 * returns nothing — that write is not news.
 */
export function planPermitEvents(before, after) {
  if (!after || after.deletedAt) return []
  if (!before) {
    // A create is normally still pending. A document that arrives already
    // decided — an import, a replay — is that decision, not a fresh raise,
    // or the mail would say it is waiting for an approval it already has.
    if (after.closedDueToObservation) {
      return [
        makeEvent('closed_noncompliance', {
          actorUid: after.closedDueToObservation?.by || after.createdBy,
          token: `closed_noncompliance:${after.closedDueToObservation?.at || 'create'}`,
        }),
      ]
    }
    if (bothApproved(after)) {
      return [makeEvent('issued', { actorUid: after.createdBy, token: 'issued' })]
    }
    for (const team of TEAMS) {
      if (statusOf(after, team) === 'rejected') {
        return [
          makeEvent('rejected', {
            actorUid: after[team]?.by || after.createdBy,
            token: `rejected:${team}:${after[team]?.at || 'create'}`,
            team,
          }),
        ]
      }
    }
    const open = unassignedTeams(after)
    return [
      makeEvent('raised', {
        actorUid: after.createdBy,
        token: 'raised',
        needsTeam: open.length > 0,
      }),
    ]
  }

  const events = []
  if (!before.closedDueToObservation && after.closedDueToObservation) {
    events.push(
      makeEvent('closed_noncompliance', {
        actorUid: after.closedDueToObservation?.by,
        token: `closed_noncompliance:${after.closedDueToObservation?.at || ''}`,
      })
    )
  }

  if (bothApproved(after) && !bothApproved(before)) {
    const actorTeam = TEAMS.find(
      (team) => statusOf(before, team) !== 'approved' && statusOf(after, team) === 'approved'
    )
    events.push(
      makeEvent('issued', {
        actorUid: actorTeam ? after[actorTeam]?.by : '',
        token: 'issued',
      })
    )
  } else {
    for (const team of TEAMS) {
      const prev = statusOf(before, team)
      const next = statusOf(after, team)
      if (prev === next) continue
      if (next !== 'approved' && next !== 'rejected') continue
      const other = team === 'engineering' ? 'operations' : 'engineering'
      const otherOpen =
        next === 'approved' && statusOf(after, other) !== 'approved' && !assigneeFor(after, other)
      events.push(
        makeEvent(next === 'approved' ? 'approved' : 'rejected', {
          actorUid: after[team]?.by,
          token: `${next}:${team}:${after[team]?.at || ''}`,
          team,
          needsTeam: otherOpen,
        })
      )
    }
  }

  events.push(
    ...decisionEvents(
      before,
      after,
      'closure',
      'closure_requested',
      'closure_rejected',
      'closed',
      'closed'
    )
  )
  events.push(
    ...decisionEvents(
      before,
      after,
      'extension',
      'extension_requested',
      'extension_rejected',
      'extended',
      'extended'
    )
  )
  return events
}

function namedUsers(permit, users) {
  const ids = [
    permit?.createdBy,
    permit?.assignedEngineer,
    permit?.assignedOperator,
    permit?.engineering?.by,
    permit?.operations?.by,
    permit?.closure?.requestedBy,
    permit?.closure?.engineering?.by,
    permit?.closure?.operations?.by,
    permit?.extension?.requestedBy,
    permit?.extension?.engineering?.by,
    permit?.extension?.operations?.by,
    permit?.closedDueToObservation?.by,
  ]
  const wanted = new Set(ids.map(uid).filter(Boolean))
  return (users || []).filter((user) => user && wanted.has(user.uid))
}

/**
 * One site, or null when the name is missing or matches more than one.
 * An ambiguous match is not a grant.
 */
export function matchPermitSite(permit, sites) {
  const list = Array.isArray(sites) ? sites : []
  const id = uid(permit?.siteId)
  if (id) {
    const hit = list.find((site) => site && site.id === id)
    if (hit) return hit
  }
  const name = readableText(permit?.site)
  if (!name) return null
  const hits = list.filter((site) => {
    if (!site) return false
    return readableText(site.name) === name || readableText(site.code) === name
  })
  return hits.length === 1 ? hits[0] : null
}

export function isPermitApproverRole(user) {
  return PERMIT_APPROVER_ROLES.includes(user?.role)
}

/**
 * Recipients for one event. The actor is skipped: they just did the thing.
 * Named uids are included even when their role would not otherwise approve.
 * The unassigned-team fallback is approver roles whose grants reach the site.
 */
export function recipientsForPermitEvent(event, permit, users, sites, orgId) {
  const site = matchPermitSite(permit, sites)
  const scope = scopeFrom(
    {
      siteId: permit?.siteId,
      site: permit?.site,
      region: permit?.region || site?.region,
      entity: permit?.entity || site?.entity,
    },
    site
  )
  const rows = []
  const push = (user) => {
    if (!user || user.uid === event.actorUid) return
    const addr = recipientAddress(user, orgId)
    if (addr) rows.push(addr)
  }
  for (const user of namedUsers(permit, users)) push(user)
  if (event.needsTeam) {
    for (const user of users || []) {
      if (!isPermitApproverRole(user)) continue
      if (!reachesScope(user, scope)) continue
      push(user)
    }
  }
  return {
    recipients: dedupeByEmail(rows),
    region: scope.region,
    entity: scope.entity,
  }
}

function permitPath(docId) {
  const segment = safePathSegment(docId)
  return segment ? `/permits/${segment}` : '/permits'
}

export async function deliverPermitMails({
  db,
  orgId,
  docId,
  before,
  after,
  mailer,
  logger,
  now,
  users: usersIn,
  sites: sitesIn,
  readObject,
}) {
  const events = planPermitEvents(before, after)
  if (!events.length) return { sent: 0, skipped: 0, failed: 0 }

  const users = usersIn || (await loadOrgUsers(db, orgId))
  let sites = sitesIn
  if (!sites) {
    const snap = await db.collection(`organizations/${orgId}/sites`).get()
    sites = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }))
  }

  const flat = []
  for (const event of events) {
    const resolved = recipientsForPermitEvent(event, after, users, sites, orgId)
    for (const recipient of resolved.recipients) {
      flat.push({
        ...recipient,
        event: { ...event, region: resolved.region, entity: resolved.entity },
      })
    }
  }

  const origin = mailer?.config?.appOrigin || ''
  // The permit copy, plus files already stored on this permit. Built before
  // the claim so a missing object cannot mark the row failed.
  let attachments = []
  if (flat.length && describeMailGap(mailer?.config).length === 0) {
    const clock = typeof now === 'function' ? now() : new Date()
    attachments = await loadReportAttachments(
      () =>
        permitMailAttachments({
          db,
          orgId,
          permitId: docId,
          permit: after,
          readObject,
          appOrigin: origin,
          logger,
          context: { orgId, docId, kind: 'permit.lifecycle' },
          now: clock instanceof Date ? clock.getTime() : Date.now(),
        }),
      logger,
      { orgId, docId, kind: 'permit.lifecycle' }
    )
  }
  return circulate({
    db,
    orgId,
    recipients: flat,
    kind: 'permit.lifecycle',
    keyFor: (recipient) => ['permit', orgId, docId, recipient.event.token, recipient.uid],
    messageFor: (recipient) =>
      renderPermitMail(
        after,
        { ...recipient.event, teamLabel: teamLabel(recipient.event.team), path: permitPath(docId) },
        { appOrigin: origin }
      ),
    mailer,
    logger,
    now,
    logLabel: 'permit',
    context: { docId },
    attachments,
  })
}
