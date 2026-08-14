// ─────────────────────────────────────────────────────────────────────────────
// Finding newly-assigned corrective actions.
//
// There is no `actions` collection. The action tracker in the app is a derived
// view that reads corrective actions out of nine unrelated collections, each of
// which keeps them under a different field name — and one of which keeps them in
// a map rather than an array. So "notify the person an action was assigned to"
// is not a document trigger — it is a diff of rows nested inside a document that
// was written for some other reason entirely.
//
// This mirrors src/modules/actions/lib/sources.js. It is a deliberate copy, not
// an import: functions/ deploys as its own package and cannot reach into src/.
// Only the fields needed to address an email are duplicated — status
// transitions, links and write-back all stay in the client's copy. A source
// added there needs a line here AND a trigger in index.js: four of the nine had
// neither, so their assignments were never mailed and their overdue rows never
// reached a digest.
// ─────────────────────────────────────────────────────────────────────────────

/** collection → where its corrective actions live, and how to describe one. */
import { createHash } from 'node:crypto'

export const ACTION_SOURCES = {
  incidents: { field: 'capa', label: 'Incident', context: (d) => d.refNo || d.referenceNo || 'Incident' },
  illnesses: { field: 'actions', label: 'Illness', context: (d) => d.refNo || 'Illness' },
  mockDrills: {
    field: 'capa',
    label: 'Mock drill',
    context: (d) => [d.scenario || 'Drill', d.centerName].filter(Boolean).join(' · '),
  },
  auditFindings: {
    field: 'findings',
    label: 'Audit finding',
    context: (d) => [d.docId || 'Audit', d.taskDetails?.dept].filter(Boolean).join(' · '),
    // A finding is written {id,type,desc,clause,evidence,auditeeDueDate} and
    // names nobody at all: the CAPA owner only exists once the auditee answers
    // the finding, and the auditee themselves is recorded on the AUDIT, not on
    // the row. Reading the row alone left every finding unaddressable, so this
    // collection's trigger could never send anything to anyone.
    people: (row, doc) => {
      const owner = row?.response?.owner || doc?.taskDetails?.auditee || doc?.auditor
      return owner ? [{ name: owner }] : []
    },
    title: (row) =>
      `${row?.type || 'Finding'}: ${row?.desc || row?.description || 'Corrective action'}` +
      (row?.clause ? ` (clause ${row.clause})` : ''),
    due: (row) => row?.auditeeDueDate || '',
    // A finding gains a status of its own only when somebody moves it in the
    // action tracker. Until then the audit's own lifecycle is the only record
    // of whether the work is finished, so without this a verified-and-closed
    // audit's findings stay overdue in the digest forever.
    status: (row, doc) => row?.status || doc?.status || '',
  },
  consultations: { field: 'actions', label: 'Meeting', context: (d) => d.subject || d.docId || 'Meeting' },
  // Stakeholder issues shape their CAPA rows exactly like an incident's — the
  // client's shaper says so out loud — so the defaults below read them whole.
  escalations: { field: 'capa', label: 'Escalation', context: (d) => d.docId || d.title || 'Customer escalation' },
  legalIssues: { field: 'capa', label: 'Legal', context: (d) => d.docId || d.title || 'Legal issue' },
  inspectionRecords: {
    field: 'responses',
    label: 'Inspection',
    context: (d) => [d.templateTitle || 'Inspection', d.siteName].filter(Boolean).join(' · '),
    // The only source whose rows are not an array. A checklist answers into a
    // map keyed by the template's field id, every question gets an entry, and
    // only the failed ones are corrective actions. That key is also the handle
    // the app writes a status change back through, so it is the row id here —
    // a positional index would move under the diff whenever the form changed.
    rows: (data) => Object.entries(data?.responses || {}).filter(([, r]) => r?.answer === 'Fail'),
    // Deliberately NOT falling back to `inspector` the way the tracker's own
    // display does. The inspector is the person who just wrote this record;
    // mailing them "an action has been assigned to you" for each box they
    // ticked Fail mails somebody their own paperwork, ten times over. An
    // unowned failure still reaches an admin through the digest.
    people: (row) => (row?.actionOwner ? [{ name: row.actionOwner }] : []),
    title: (row) =>
      row?.action
        ? `${row?.label || 'Failed check'} — ${row.action}`
        : `${row?.label || 'Failed check'}${row?.observation ? ` — ${row.observation}` : ''}`,
    due: (row) => row?.actionDue || '',
    status: (row) => row?.actionStatus || '',
  },
  // Extinguisher physical defects are the ninth source and are deliberately
  // absent. Their rows are bare strings ('pin', 'empty') with no due date and
  // nobody assigned — the tracker shows `lastActionBy`, which is whoever last
  // touched the unit, usually the person who reported the fault from the public
  // QR page. Mailing them would be telling somebody what they just told us, and
  // a trigger on that collection fires on every scan and inspection.
}

/**
 * Stable identity for one row, so a diff can tell "new" from "edited".
 *
 * The fallback used to be the array index, and for the two sources whose rows
 * carry no id of their own — drill CAPA and consultations — the index WAS the
 * identity. A position is not an identity. Delete the second of five rows and
 * the three below it renumber; the diff sees three rows whose contents changed
 * completely, calls them new assignments, and mails everybody attached to them
 * about work they were told about weeks ago. Closing one action re-notifies the
 * rest of the list.
 *
 * Hashing the row's own describing fields buys the opposite mistake: rewording
 * an action reads as a new row and re-mails its owner. That is one message to
 * one person on the rarer event, against a cascade to everyone below the
 * commoner one.
 *
 * Only the fields that say WHAT the assignment is and WHO it belongs to. Status
 * and progress are deliberately excluded — moving a row to in-progress must not
 * change what it is. Two rows identical in all of them collide, and should: for
 * notification purposes that is one assignment, and one mail is the right
 * number.
 */
const IDENTIFYING = ['action', 'description', 'title', 'defect', 'desc', 'owner', 'ownerName', 'responsible', 'assignedTo', 'due', 'dueDate']

const rowKey = (row) =>
  createHash('sha1')
    .update(IDENTIFYING.map((k) => String(row?.[k] ?? '')).join('\u0000'))
    .digest('hex')
    .slice(0, 16)

const rowId = (row) => String(row?.id ?? row?.actionId ?? rowKey(row))

/**
 * Everyone a single CAPA row is addressed to, as recipient references.
 *
 * Two shapes coexist. Rows written since the drill-CAPA change carry
 * `assignees: [{uid, name}]` — addressable with certainty. Older rows carry a
 * free-text `owner`, which resolveRecipient() will only act on if exactly one
 * person in the org answers to that name. Both are emitted; the recipient layer
 * decides what is safe to use.
 */
const defaultPeople = (row) => {
  const assignees = Array.isArray(row?.assignees) ? row.assignees : []
  if (assignees.length) return assignees.map((a) => ({ uid: a?.uid, name: a?.name }))
  const owner = row?.owner || row?.ownerName || row?.responsible || row?.assignedTo
  return owner ? [{ name: owner }] : []
}

// Five modules, five vocabularies for the same three facts about a row. The
// union is ordered so a row carrying more than one of these fields still reads
// exactly the way it did before any of this became overridable.
const defaultTitle = (row) => row?.description || row?.title || row?.action || row?.defect || 'Corrective action'
const defaultDue = (row) => row?.dueDate || row?.due || ''
const defaultStatus = (row) => row?.status || ''

// A collection whose rows do not look like a CAPA row at all overrides these;
// the parent document is passed because for some of them the answer is not in
// the row (see auditFindings above).
const refsFor = (row, meta, doc) => (meta.people || defaultPeople)(row, doc)
export const titleOf = (row, meta, doc) => (meta.title || defaultTitle)(row, doc)
export const dueOf = (row, meta, doc) => (meta.due || defaultDue)(row, doc)
export const statusOf = (row, meta, doc) => (meta.status || defaultStatus)(row, doc)

const describe = (row, meta, doc) => ({
  title: titleOf(row, meta, doc),
  dueDate: dueOf(row, meta, doc),
  priority: row?.priority || '',
  source: meta.label,
  site: doc?.centerName || doc?.siteName || doc?.site || '',
  context: meta.context(doc || {}),
})

/**
 * Rows keyed by id, for whichever collection this is.
 *
 * Exported because the digest has to find the same rows this diff does, and the
 * two of them reading a document differently is exactly how a whole collection
 * goes missing from one of them without anyone noticing.
 */
export const rowsOf = (data, meta) => {
  if (!meta) return new Map()
  if (meta.rows) return new Map(meta.rows(data || {}))
  const arr = Array.isArray(data?.[meta.field]) ? data[meta.field] : []
  return new Map(arr.filter(Boolean).map((row) => [rowId(row), row]))
}

/**
 * Compare a document before and after a write, and report assignments that are
 * newly addressed to someone.
 *
 * Fires when a row is added, and when an existing row gains an assignee it did
 * not have before. It deliberately does NOT fire when some unrelated part of
 * the row changes — a due date being edited, a status moving to in-progress —
 * because every one of those would otherwise re-mail everyone attached to it.
 *
 * @returns [{ action, refs }] — refs are unresolved; the recipients layer decides
 */
export function newAssignments(collection, before, after) {
  const meta = ACTION_SOURCES[collection]
  if (!meta || !after) return []

  const prev = rowsOf(before, meta)
  const next = rowsOf(after, meta)
  const out = []

  for (const [id, row] of next) {
    const refs = refsFor(row, meta, after)
    if (!refs.length) continue

    const old = prev.get(id)
    // A brand-new row notifies everyone on it; an existing row notifies only
    // the people who were not already on it. The old row is read against the
    // OLD document, because for some collections the parent is where the
    // people come from and it can move under the row.
    const already = new Set(old ? refsFor(old, meta, before).map(refKey) : [])
    const fresh = refs.filter((r) => !already.has(refKey(r)))
    if (!fresh.length) continue

    // Closed work is not worth an email, however it got that way.
    const status = String(statusOf(row, meta, after)).toLowerCase()
    if (status === 'closed' || status === 'done' || status === 'completed') continue

    out.push({ id, action: describe(row, meta, after), refs: fresh })
  }
  return out
}

const refKey = (r) => (r?.uid ? `uid:${r.uid}` : `name:${String(r?.name ?? '').trim().toLowerCase()}`)
