// Mail the people a LOTO permit names, when its lifecycle moves.
//
// The document is organizations/{orgId}/lotoPermits/{permitNo}. This trigger
// sees every write to it and mails on exactly these changes:
//
//   created as 'requested'          requested
//   requested -> approved           approved
//   requested -> rejected           rejected
//   extensions grew (still active)  extended
//   active -> returned              returned
//   active -> emergency_removed     emergency_removed
//   flags: due set                  due        (written by sweepLotoPermits)
//   flags: overdueCount grew        overdue    (repeat; escalated from the 3rd)
//
// Not mailed: withdrawn, and the start of isolation. The first is the
// requester's own act on their own request; the second changes nothing for
// anyone who has not already been told the permit was approved.
//
// Recipients, on every event, are:
//
//   the requester                       requestedBy
//   the approver / remover / returner   approval.by, emergency.by, closure.by
//   internal personnel                  personnelUids (uids — contractors are
//                                       text on the permit and have no mailbox)
//   admins and scope-grant holders      selectScopedAudience(site/region/entity)
//
// The last line is "Admin scoped to the permit's site or entity" as this
// platform can express it: there is no site-admin role, so that is every org
// admin plus every member whose site/region/entity grant reaches the permit
// (functions/lib/audience.js). The requester is placed first so the circulation
// cap can never drop them.
//
// Nothing sealed is read: names and the job description are sealed at rest and
// the server holds no key here by design. The mail carries the permit number,
// work type, equipment, site, window and status, and names the ACTOR from their
// user profile — which is not sealed.
import { safePathSegment } from './assignmentNotify.js'
import {
  addressForToken,
  dedupeByEmail,
  loadOrgUsers,
  recipientAddress,
  scopeFrom,
  selectScopedAudience,
} from './audience.js'
import { circulate } from './circulate.js'
import { loadOrgDisplayName } from './mailBrand.js'
import { renderLotoPermitMail } from './mailTemplates/lifecycle.js'
import { matchPermitSite } from './permitNotify.js'
import { OVERDUE_ESCALATE_AT } from './lotoPermitSweep.js'

const COPY = {
  requested: {
    subjectLead: 'LOTO permit requested',
    headline: 'A lockout/tagout permit was requested and is waiting for approval.',
    status: 'Awaiting approval',
  },
  approved: {
    subjectLead: 'LOTO permit approved',
    headline: 'A lockout/tagout permit was approved. Isolation can begin.',
    status: 'Approved — not started',
  },
  rejected: {
    subjectLead: 'LOTO permit rejected',
    headline: 'A lockout/tagout permit was rejected. Work must not start.',
    status: 'Rejected',
  },
  extended: {
    subjectLead: 'LOTO permit extended',
    headline: 'The window on an active lockout/tagout permit was extended.',
    status: 'Active — window extended',
  },
  returned: {
    subjectLead: 'LOTO permit returned',
    headline: 'Work is finished: the locks are off and the equipment was returned.',
    status: 'Returned',
  },
  emergency_removed: {
    subjectLead: 'LOTO permit — EMERGENCY REMOVAL',
    headline: 'An administrator removed every lock on this permit without the lock owner.',
    status: 'Emergency removal',
    detailNote: 'The reason and attestations are on the permit.',
  },
  due: {
    subjectLead: 'LOTO permit due',
    headline: 'The window on an active lockout/tagout permit ends soon.',
    status: 'Active — due',
  },
  overdue: {
    subjectLead: 'LOTO permit OVERDUE',
    headline:
      'The window has ended and the permit is still active. Return it, or ask an administrator to extend it.',
    status: 'Active — overdue',
  },
  overdue_escalated: {
    subjectLead: 'LOTO permit OVERDUE — ESCALATED',
    headline:
      'This permit is still active well past its window. Locks are on this equipment: confirm who is at the machine and return or extend the permit now.',
    status: 'Active — overdue (escalated)',
  },
}

const uid = (v) => (typeof v === 'string' ? v.trim() : '')

/** Epoch ms from a Timestamp, a number, or a Date; NaN when none. */
export function msOf(value) {
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?._seconds === 'number') return value._seconds * 1000
  return Number.NaN
}

function make(name, fields) {
  return { name, actorUid: uid(fields.actorUid), token: fields.token, ...COPY[name] }
}

/**
 * The lifecycle events on this write. A write that changes none of the above
 * (a client touching updatedAt, the sweep re-writing identical flags) returns [].
 */
export function planLotoPermitEvents(before, after) {
  if (!after) return []
  if (!before) {
    // A document that arrives already decided (an import, a replay) is not a
    // fresh request, and saying it awaits approval would be wrong.
    return after.status === 'requested'
      ? [make('requested', { actorUid: after.requestedBy, token: 'requested' })]
      : []
  }
  const events = []
  const was = before.status
  const now = after.status

  if (was === 'requested' && now === 'approved') {
    events.push(
      make('approved', {
        actorUid: after.approval?.by,
        token: `approved:${msOf(after.approval?.at) || ''}`,
      })
    )
  } else if (was === 'requested' && now === 'rejected') {
    events.push(
      make('rejected', {
        actorUid: after.approval?.by,
        token: `rejected:${msOf(after.approval?.at) || ''}`,
      })
    )
  } else if (was === 'active' && now === 'returned') {
    events.push(make('returned', { actorUid: after.closure?.by, token: 'returned' }))
  } else if (was === 'active' && now === 'emergency_removed') {
    events.push(
      make('emergency_removed', { actorUid: after.emergency?.by, token: 'emergency_removed' })
    )
  }

  if (now === 'active' && was === 'active') {
    const before_n = Array.isArray(before.extensions) ? before.extensions.length : 0
    const after_n = Array.isArray(after.extensions) ? after.extensions.length : 0
    if (after_n > before_n) {
      const last = after.extensions[after_n - 1]
      events.push(make('extended', { actorUid: last?.by, token: `extended:${after_n}` }))
    }
    events.push(...flagEvents(before, after))
  }
  return events
}

/** due / overdue from the server-written flags. Only ever for the CURRENT window. */
function flagEvents(before, after) {
  const out = []
  const pf = before.flags || {}
  const af = after.flags || {}
  const end = msOf(after.windowEnd)
  // Flags written for an older window (before an extension) describe a deadline
  // that no longer exists.
  if (!Number.isFinite(end) || af.windowEnd !== end) return out
  const sameWindow = pf.windowEnd === af.windowEnd
  if (af.dueAt && !(sameWindow && pf.dueAt)) {
    out.push(make('due', { actorUid: '', token: `due:${end}` }))
  }
  const count = Number(af.overdueCount) || 0
  const prevCount = sameWindow ? Number(pf.overdueCount) || 0 : 0
  if (count > prevCount) {
    out.push(
      make(count >= OVERDUE_ESCALATE_AT ? 'overdue_escalated' : 'overdue', {
        actorUid: '',
        token: `overdue:${end}:${count}`,
      })
    )
  }
  return out
}

function addressForUid(users, orgId, value) {
  const id = uid(value)
  if (!id) return null
  return recipientAddress(
    (users || []).find((u) => u && uid(u.uid) === id),
    orgId
  )
}

/** Move the requester's mailbox to the front, so the cap cannot drop them. */
function requesterFirst(rows, requester) {
  if (!requester) return rows
  const email = requester.email.toLowerCase()
  const i = rows.findIndex((r) => r.uid === requester.uid || r.email.toLowerCase() === email)
  if (i <= 0) return rows
  return [rows[i], ...rows.slice(0, i), ...rows.slice(i + 1)]
}

/**
 * Everyone this event goes to. The event does not filter: every kind reaches
 * the same people, because the decision was to tell ALL named people each time.
 */
export function recipientsForLotoEvent(_event, permit, users, sites, orgId) {
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
  const requester = addressForUid(users, orgId, permit?.requestedBy)
  if (requester) rows.push(requester)
  for (const by of [permit?.approval?.by, permit?.emergency?.by, permit?.closure?.by]) {
    const addr = addressForUid(users, orgId, by)
    if (addr) rows.push(addr)
  }
  for (const id of Array.isArray(permit?.personnelUids) ? permit.personnelUids : []) {
    const addr = addressForToken(users, orgId, id)
    if (addr) rows.push(addr)
  }
  rows.push(...selectScopedAudience(users, orgId, scope))
  return {
    recipients: requesterFirst(dedupeByEmail(rows), requester),
    region: scope.region,
    entity: scope.entity,
  }
}

const permitPath = (docId) => {
  const segment = safePathSegment(docId)
  return segment ? `/loto/permits/${segment}` : '/loto/permits'
}

const nameOf = (users, id) => {
  const u = (users || []).find((x) => x && uid(x.uid) === uid(id))
  return typeof u?.name === 'string' ? u.name.trim() : ''
}

export async function deliverLotoPermitMails({
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
  sleep,
  gapMs,
}) {
  const events = planLotoPermitEvents(before, after)
  if (!events.length) return { sent: 0, skipped: 0, failed: 0 }

  const users = usersIn || (await loadOrgUsers(db, orgId))
  let sites = sitesIn
  if (!sites) {
    const snap = await db.collection(`organizations/${orgId}/sites`).get()
    sites = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }))
  }

  const flat = []
  for (const event of events) {
    const resolved = recipientsForLotoEvent(event, after, users, sites, orgId)
    for (const recipient of resolved.recipients) {
      flat.push({
        ...recipient,
        event: {
          ...event,
          actorName: nameOf(users, event.actorUid),
          region: resolved.region,
          entity: resolved.entity,
        },
      })
    }
  }

  const origin = mailer?.config?.appOrigin || ''
  const sender = flat.length ? await loadOrgDisplayName(db, orgId) : ''
  return circulate({
    db,
    orgId,
    recipients: flat,
    kind: 'lotoPermit.lifecycle',
    keyFor: (recipient) => ['lotoPermit', orgId, docId, recipient.event.token, recipient.uid],
    messageFor: (recipient) =>
      renderLotoPermitMail(
        after,
        { ...recipient.event, path: permitPath(docId) },
        { appOrigin: origin, sender }
      ),
    mailer,
    logger,
    now,
    logLabel: 'loto permit',
    context: { docId },
    sleep,
    gapMs,
  })
}
