// Mail the people a permit names, when its lifecycle moves.
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
// Recipients, on every lifecycle event, are exactly:
//
//   createdBy                 the person who raised it. Always, including
//                             when they are the event actor. Skipping the
//                             actor is why a raise used to send them nothing.
//   participants[].name       Internal Personnel. The form stores type
//                             'internal' and the teammate's display name,
//                             not a uid (PermitForm). An external participant
//                             is not an org user. A name that matches two
//                             profiles is not a guess, so neither is mailed.
//   assignedEngineer          the specific Engineering approver, a uid.
//                             Blank means "whole Engineering team" and that
//                             team is not mailed.
//   assignedOperator          the specific Operations approver, a uid.
//                             Blank means the ops team is not mailed.
//
// Not the audience: site, entity or region grants, org admins who were not
// named, fire watchers, the confined-space watcher, and the receiver
// (issuedToName / issuedToPhone). Those last three are display names and a
// phone, and they are not the internal-personnel list.
//
// A named person with no usable address is still not mailed. Pending,
// suspended, another org, or not an email: there is nowhere to send it.
// One mailbox is one send. The raiser is placed first so the circulation
// cap cannot drop them.
import { safePathSegment } from './assignmentNotify.js'
import {
  scopeFrom,
  addressForToken,
  recipientAddress,
  dedupeByEmail,
  loadOrgUsers,
} from './audience.js'
import { circulate } from './circulate.js'
import { loadOrgDisplayName } from './mailBrand.js'
import { describeMailGap } from './mailer.js'
import { loadReportAttachments } from './mailAttachments.js'
import { permitMailAttachments } from './reportAttachments.js'
import { renderPermitMail } from './mailTemplates/lifecycle.js'
import { readableText } from './mailTemplates/safe.js'

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
    return [
      makeEvent(requestedName, {
        actorUid: next.requestedBy,
        token: `${requestedName}:${next.requestedAt || ''}`,
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
    return [
      makeEvent('raised', {
        actorUid: after.createdBy,
        token: 'raised',
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
      events.push(
        makeEvent(next === 'approved' ? 'approved' : 'rejected', {
          actorUid: after[team]?.by,
          token: `${next}:${team}:${after[team]?.at || ''}`,
          team,
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

/**
 * Move the raiser's mailbox to the front. circulate sends the front of the
 * list and drops the rest at the cap. When another profile already owns the
 * raiser's address, that row is the copy — one mailbox, still first.
 */
function raiserFirst(rows, raiserUid, raiserEmail) {
  const email = typeof raiserEmail === 'string' ? raiserEmail.toLowerCase() : ''
  const index = rows.findIndex(
    (row) => row.uid === raiserUid || (email && row.email.toLowerCase() === email)
  )
  if (index <= 0) return rows
  return [rows[index], ...rows.slice(0, index), ...rows.slice(index + 1)]
}

function addressForUid(users, orgId, value) {
  const id = uid(value)
  if (!id) return null
  const person = (users || []).find((user) => user && uid(user.uid) === id)
  return recipientAddress(person, orgId)
}

/**
 * Recipients for one lifecycle event. The event is not a filter: a raise, an
 * approval and a close share this list, and event.actorUid is not removed.
 * The raiser is included even when they hold no other role on the permit.
 */
export function recipientsForPermitEvent(_event, permit, users, sites, orgId) {
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
  const raiser = addressForUid(users, orgId, permit?.createdBy)
  if (raiser) rows.push(raiser)
  const participants = Array.isArray(permit?.participants) ? permit.participants : []
  for (const person of participants) {
    if (!person || person.type !== 'internal') continue
    const addr = addressForToken(users, orgId, person.name)
    if (addr) rows.push(addr)
  }
  // Blank is "whole team" on the form. That is not a named contact.
  const engineer = addressForUid(users, orgId, permit?.assignedEngineer)
  if (engineer) rows.push(engineer)
  const operator = addressForUid(users, orgId, permit?.assignedOperator)
  if (operator) rows.push(operator)
  const deduped = dedupeByEmail(rows)
  return {
    recipients: raiserFirst(deduped, raiser?.uid || '', raiser?.email || ''),
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
  sleep,
  gapMs,
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
  const sender = flat.length ? await loadOrgDisplayName(db, orgId) : ''
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
        { appOrigin: origin, sender }
      ),
    mailer,
    logger,
    now,
    logLabel: 'permit',
    context: { docId },
    attachments,
    sleep,
    gapMs,
  })
}
