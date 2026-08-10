// ─────────────────────────────────────────────────────────────────────────────
// Finding newly-assigned corrective actions.
//
// There is no `actions` collection. The action tracker in the app is a derived
// view that reads CAPA arrays out of seven unrelated collections, each of which
// keeps them under a different field name. So "notify the person an action was
// assigned to" is not a document trigger — it is a diff of an array nested
// inside a document that was written for some other reason entirely.
//
// This mirrors src/modules/actions/lib/sources.js. It is a deliberate copy, not
// an import: functions/ deploys as its own package and cannot reach into src/.
// Only the fields needed to address an email are duplicated — status
// transitions, links and write-back all stay in the client's copy. If a new
// source collection is added there, add it here too or its assignments simply
// go unnotified (which is the safe direction to fail).
// ─────────────────────────────────────────────────────────────────────────────

/** collection → where its corrective actions live, and how to describe one. */
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
  },
  consultations: { field: 'actions', label: 'Meeting', context: (d) => d.subject || d.docId || 'Meeting' },
}

/** Stable identity for one row, so a diff can tell "new" from "edited". */
const rowId = (row, i) => String(row?.id ?? row?.actionId ?? i)

/**
 * Everyone a single CAPA row is addressed to, as recipient references.
 *
 * Two shapes coexist. Rows written since the drill-CAPA change carry
 * `assignees: [{uid, name}]` — addressable with certainty. Older rows carry a
 * free-text `owner`, which resolveRecipient() will only act on if exactly one
 * person in the org answers to that name. Both are emitted; the recipient layer
 * decides what is safe to use.
 */
const refsFor = (row) => {
  const assignees = Array.isArray(row?.assignees) ? row.assignees : []
  if (assignees.length) return assignees.map((a) => ({ uid: a?.uid, name: a?.name }))
  const owner = row?.owner || row?.ownerName || row?.responsible || row?.assignedTo
  return owner ? [{ name: owner }] : []
}

const describe = (row, meta, doc) => ({
  title: row?.description || row?.title || row?.defect || 'Corrective action',
  dueDate: row?.dueDate || row?.due || '',
  priority: row?.priority || '',
  source: meta.label,
  site: doc?.centerName || doc?.siteName || doc?.site || '',
  context: meta.context(doc || {}),
})

/** Rows keyed by id, for whichever collection this is. */
const rowsOf = (data, meta) => {
  const arr = Array.isArray(data?.[meta.field]) ? data[meta.field] : []
  return new Map(arr.filter(Boolean).map((row, i) => [rowId(row, i), row]))
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
    const refs = refsFor(row)
    if (!refs.length) continue

    const old = prev.get(id)
    // A brand-new row notifies everyone on it; an existing row notifies only
    // the people who were not already on it.
    const already = new Set(old ? refsFor(old).map(refKey) : [])
    const fresh = refs.filter((r) => !already.has(refKey(r)))
    if (!fresh.length) continue

    // Closed work is not worth an email, however it got that way.
    const status = String(row?.status || '').toLowerCase()
    if (status === 'closed' || status === 'done' || status === 'completed') continue

    out.push({ id, action: describe(row, meta, after), refs: fresh })
  }
  return out
}

const refKey = (r) => (r?.uid ? `uid:${r.uid}` : `name:${String(r?.name ?? '').trim().toLowerCase()}`)
