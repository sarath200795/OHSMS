// ─────────────────────────────────────────────────────────────────────────────
// Who just got a task, and the mail that tells them.
//
// Assignable work in this app is not one collection. The flows that name a
// person by uid — the only join that can be resolved inside the same org
// without scanning display names — are:
//
//   incidents.capa[].ownerUid            corrective / preventive actions
//   illnesses.actions[].ownerUid         same editor, occupational health
//   mockDrills.capa[].assignees[].uid    drill CAPA, one row may name several
//   trainingAssignments.employeeUid      one document per assigned course
//
// Everything else the Action Tracker shows (inspections, audits, committee,
// escalations, legal, equipment) stores a display name, and several of those
// names are sealed. A name is not an address, and matching one against the
// directory would cross people who share it. Those are left alone on purpose.
//
// Descriptions are a different problem. Incident and drill action text is
// sealed when encryption is on (src/shared/crypto/policy.js), and this
// function sees the stored document, not the decrypted one. An envelope in
// the mail would be ciphertext in someone's inbox. Illness action text is
// health data even when it is still plaintext, so it is never copied out.
// The mail names the record and, where it is safe, the action. The link is
// how they read the rest. Subject, HTML and the text fallback are assembled
// in mailTemplates/; this file only decides who is assigned and which fields
// are safe to hand across.
// ─────────────────────────────────────────────────────────────────────────────
import { notificationId, sendOnce } from './notify.js'
import { describeMailGap } from './mailer.js'
import { renderAssignmentMessage } from './mailTemplates/assignments.js'
import { readableText } from './mailTemplates/safe.js'

export { readableText, safeLine } from './mailTemplates/safe.js'

export const ASSIGNMENT_COLLECTIONS = [
  'incidents',
  'illnesses',
  'mockDrills',
  'trainingAssignments',
]

// One document write becoming an unbounded number of mails is a bill, not a
// feature. Training already writes one assignment document per person, so it
// never approaches this. A CAPA array past it is not a real batch.
export const MAX_MAILS_PER_WRITE = 100

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function closedStatus(status) {
  return (
    String(status || '')
      .trim()
      .toLowerCase() === 'closed'
  )
}

function uidOf(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * A document id that can sit in a URL path. The trigger param is already one
 * segment of a Firestore path; this refuses the shapes that would still
 * change what the link points at once it is concatenated.
 */
export function safePathSegment(id) {
  if (typeof id !== 'string' || !id || id === '.' || id === '..') return ''
  if (/[/?#\\\s]/.test(id)) return ''
  return encodeURIComponent(id)
}

function incidentSlots(data, docId) {
  return arraySlots(data?.capa, {
    uidField: 'ownerUid',
    titleOf: (item) => item.description || item.title,
    dueOf: (item) => item.dueDate,
    closedOf: (item) => closedStatus(item.status),
    includeTitle: true,
    kind: 'assignment.incident_capa',
    what: 'corrective action',
    context: readableText(data?.refNo) || readableText(data?.docId),
    path: pathFor('/incidents', docId),
  })
}

function illnessSlots(data, docId) {
  // includeTitle is false even when the description is plaintext. This
  // collection is the occupational-health record. The mail names the record;
  // the action text stays in the app, where the illness rules apply.
  return arraySlots(data?.actions, {
    uidField: 'ownerUid',
    titleOf: () => '',
    dueOf: (item) => item.dueDate,
    closedOf: (item) => closedStatus(item.status),
    includeTitle: false,
    kind: 'assignment.illness_action',
    what: 'corrective action on an occupational illness record',
    context: readableText(data?.refNo) || readableText(data?.docId),
    path: pathFor('/incidents/illness', docId),
  })
}

function drillSlots(data) {
  if (!Array.isArray(data?.capa)) return []
  const context = readableText(data.scenario) || readableText(data.docId)
  const slots = []
  data.capa.forEach((row, index) => {
    if (!row || typeof row !== 'object') return
    const people = Array.isArray(row.assignees) ? row.assignees : []
    for (const person of people) {
      const assigneeUid = uidOf(person?.uid)
      if (!assigneeUid) continue
      // The row has no id of its own — the tracker uses the index too. The
      // uid is part of the slot so adding a second person is a new slot, and
      // reordering the array looks like a new assignment. Drill CAPA is
      // written once, on the report, which is why that trade is acceptable.
      slots.push({
        slotId: `${index}:${assigneeUid}`,
        assigneeUid,
        actorUid: uidOf(row.assignedByUid),
        title: readableText(row.action),
        due: typeof row.due === 'string' ? row.due : '',
        closed: closedStatus(row.status),
        includeTitle: true,
        kind: 'assignment.drill_capa',
        what: 'mock-drill corrective action',
        context,
        path: '/mock-drills',
      })
    }
  })
  return slots
}

function trainingSlots(data) {
  if (!data || typeof data !== 'object') return []
  return [
    {
      slotId: 'assignee',
      assigneeUid: uidOf(data.employeeUid),
      actorUid: uidOf(data.assignedBy),
      title: readableText(data.courseName),
      due: typeof data.dueDate === 'string' ? data.dueDate : '',
      // Only an open assignment is news. Completing, cancelling, or editing
      // the due date of someone already assigned is not a new assignment.
      // Reopening (completed → assigned) is, because the previous slot was
      // closed and so is not in the "already assigned" set.
      closed: data.status !== 'assigned',
      includeTitle: true,
      kind: 'assignment.training',
      what: 'training course',
      context: 'Training',
      path: '/training/my',
    },
  ]
}

function pathFor(base, docId) {
  const segment = safePathSegment(docId)
  return segment ? `${base}/${segment}` : base
}

function arraySlots(list, spec) {
  if (!Array.isArray(list)) return []
  const slots = []
  list.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const assigneeUid = uidOf(item[spec.uidField])
    if (!assigneeUid) return
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : ''
    slots.push({
      slotId: id || `index:${index}`,
      assigneeUid,
      actorUid: uidOf(item.assignedByUid),
      title: spec.includeTitle ? readableText(spec.titleOf(item)) : '',
      due: typeof spec.dueOf(item) === 'string' ? spec.dueOf(item) : '',
      closed: spec.closedOf(item),
      includeTitle: spec.includeTitle,
      kind: spec.kind,
      what: spec.what,
      context: spec.context,
      path: spec.path,
    })
  })
  return slots
}

const SLOTS = {
  incidents: incidentSlots,
  illnesses: illnessSlots,
  mockDrills: (data) => drillSlots(data),
  trainingAssignments: trainingSlots,
}

function dedupe(slots) {
  const byId = new Map()
  for (const slot of slots) byId.set(slot.slotId, slot)
  return [...byId.values()]
}

/**
 * Assignments that are new on `after`, or whose assignee changed.
 * `before` / `after` are the stored documents (null when absent).
 * A soft-deleted parent notifies nobody: the work is not being handed out.
 */
export function planAssignmentMails({ collection, before, after, docId }) {
  const read = SLOTS[collection]
  if (!read || !after || after.deletedAt) return []
  const next = dedupe(read(after, docId))
  const prevOpen = new Map()
  if (before && !before.deletedAt) {
    for (const slot of dedupe(read(before, docId))) {
      if (!slot.closed && slot.assigneeUid) prevOpen.set(slot.slotId, slot.assigneeUid)
    }
  }
  return next.filter((slot) => {
    if (!slot.assigneeUid || slot.closed) return false
    return prevOpen.get(slot.slotId) !== slot.assigneeUid
  })
}

/**
 * Checks that need no directory read. A uid with a slash is not a user id —
 * the Admin SDK would treat it as a path and read some other document.
 * Self-assignment is skipped when the writer is known (assignedBy / the
 * stamped assignedByUid). When the writer is not on the document, the mail
 * still goes out: skipping on a guess would drop the one this exists to send.
 */
export function precheckAssignee({ assigneeUid, actorUid }) {
  if (
    typeof assigneeUid !== 'string' ||
    !assigneeUid ||
    assigneeUid === '.' ||
    assigneeUid === '..' ||
    assigneeUid.includes('/')
  ) {
    return { send: false, reason: 'bad-uid' }
  }
  if (actorUid && actorUid === assigneeUid) return { send: false, reason: 'self' }
  return null
}

/**
 * Whether this assignee should receive the mail. `user` is their /users
 * profile, or null. Tenancy is the profile's orgId, not anything written on
 * the task — a task document can name any uid, and the directory is what
 * says the person belongs here.
 */
export function deliveryDecision({ assigneeUid, actorUid, user, orgId }) {
  const early = precheckAssignee({ assigneeUid, actorUid })
  if (early) return early
  if (!user || typeof user !== 'object') return { send: false, reason: 'no-user' }
  if (user.orgId !== orgId) return { send: false, reason: 'cross-tenant' }
  // A missing status is a profile from before the field existed. pending /
  // rejected / suspended are not people who can open the link.
  if (user.status && user.status !== 'approved') return { send: false, reason: 'not-approved' }
  const email = typeof user.email === 'string' ? user.email.trim() : ''
  if (!EMAIL_RE.test(email)) return { send: false, reason: 'no-email' }
  return { send: true, email }
}

/**
 * Subject, HTML and text for one planned assignment. The wording lives in
 * mailTemplates so each module can change copy without the send ledger
 * changing with it. sendOnce keys on the slot, not the body, so a template
 * edit does not mail the same assignment a second time.
 */
export function renderAssignmentMail(plan, options) {
  return renderAssignmentMessage(plan, options)
}

/**
 * The document the trigger just wrote, or null. Admin snapshots expose
 * `exists` as a boolean; the client SDK uses a function. The trigger passes
 * whichever it was given.
 */
export function writtenData(snap) {
  if (!snap) return null
  if (!snapshotExists(snap)) return null
  const data = typeof snap.data === 'function' ? snap.data() : null
  return data || null
}

function snapshotExists(snap) {
  if (!snap) return false
  return typeof snap.exists === 'function' ? Boolean(snap.exists()) : Boolean(snap.exists)
}

function noopLogger() {
  return { info() {}, error() {} }
}

/**
 * Send one mail per new assignee. Never throws for a mail failure or a
 * missing provider — the assignment write has already committed, and this
 * must not turn a successful save into a retry storm.
 *
 * A missing provider does NOT claim the ledger. The claim is what suppresses
 * a later send of the same event, and the event will not be re-delivered
 * after the operator sets SMTP. Claiming it now would make the configuration
 * fix apply only to assignments made afterwards, silently.
 */
export async function deliverAssignments({
  db,
  collection,
  orgId,
  docId,
  before,
  after,
  eventId,
  mailer,
  logger,
  now = () => new Date(),
}) {
  const log = logger || noopLogger()
  const plans = planAssignmentMails({ collection, before, after, docId })
  if (!plans.length) return { sent: 0, skipped: 0, failed: 0 }

  const missing = describeMailGap(mailer?.config)
  if (missing.length) {
    log.error('assignment mail is not configured', {
      orgId,
      collection,
      docId,
      missing,
      count: plans.length,
    })
    return { sent: 0, skipped: plans.length, failed: 0, reason: 'not-configured' }
  }

  const batch = plans.slice(0, MAX_MAILS_PER_WRITE)
  if (plans.length > batch.length) {
    log.error('assignment mail capped', {
      orgId,
      collection,
      docId,
      count: plans.length,
      cap: MAX_MAILS_PER_WRITE,
    })
  }

  let sent = 0
  let skipped = plans.length - batch.length
  let failed = 0

  for (const plan of batch) {
    // Self and a malformed uid need nothing from the directory. Fetching
    // first would turn "assigned to yourself" into a read on every save.
    const early = precheckAssignee(plan)
    if (early) {
      log.info('assignment mail skipped', {
        orgId,
        collection,
        docId,
        slotId: plan.slotId,
        reason: early.reason,
      })
      skipped += 1
      continue
    }

    const userSnap = await db.doc(`users/${plan.assigneeUid}`).get()
    const user = snapshotExists(userSnap) ? userSnap.data() : null
    const resolved = deliveryDecision({
      assigneeUid: plan.assigneeUid,
      actorUid: plan.actorUid,
      user,
      orgId,
    })
    if (!resolved.send) {
      log.info('assignment mail skipped', {
        orgId,
        collection,
        docId,
        slotId: plan.slotId,
        reason: resolved.reason,
      })
      skipped += 1
      continue
    }

    let assignerName = ''
    if (plan.actorUid && plan.actorUid !== plan.assigneeUid && !plan.actorUid.includes('/')) {
      const actorSnap = await db.doc(`users/${plan.actorUid}`).get()
      const actor = snapshotExists(actorSnap) ? actorSnap.data() : null
      if (actor && actor.orgId === orgId) assignerName = readableText(actor.name)
    }

    const message = renderAssignmentMail(plan, {
      assignerName,
      appOrigin: mailer.config.appOrigin,
    })
    const key = [orgId, collection, docId, plan.slotId, plan.assigneeUid, eventId || '']
    const ref = db.doc(`organizations/${orgId}/notifications/${notificationId(key)}`)
    const result = await sendOnce({
      ref,
      kind: plan.kind,
      key,
      uid: plan.assigneeUid,
      subject: message.subject,
      now: now(),
      send: () =>
        mailer.send({
          to: resolved.email,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
    })

    if (result.status === 'sent') {
      sent += 1
      log.info('assignment mail sent', {
        orgId,
        collection,
        docId,
        slotId: plan.slotId,
        kind: plan.kind,
      })
    } else if (result.status === 'failed') {
      failed += 1
      log.error('assignment mail failed', {
        orgId,
        collection,
        docId,
        slotId: plan.slotId,
        error: result.error?.message || 'send-failed',
      })
    } else {
      skipped += 1
      log.info('assignment mail skipped', {
        orgId,
        collection,
        docId,
        slotId: plan.slotId,
        reason: result.reason,
      })
    }
  }

  return { sent, skipped, failed }
}
