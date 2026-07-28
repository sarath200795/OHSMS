// ─────────────────────────────────────────────────────────────────────────────
// Central Action Tracker — source adapters.
//
// Action / CAPA items live embedded inside each module's own documents in
// different shapes and with different status vocabularies. Each adapter here
// knows how to (a) read a source collection, (b) flatten its actions into one
// normalized shape, and (c) write a status change back into the source document
// so the update shows up in the originating module too.
//
// Normalized status: 'open' | 'in_progress' | 'done'.
// ─────────────────────────────────────────────────────────────────────────────
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { db } from '../../../shared/firebase'
import { subscribeOrgCollection } from '../../../shared/org/orgData'

const dref = (orgId, name, id) => doc(db, 'organizations', orgId, name, id)

export const NORM_STATUS = [
  { key: 'open', label: 'Open', color: '#ef4444' },
  { key: 'in_progress', label: 'In Progress', color: '#f59e0b' },
  { key: 'done', label: 'Done', color: '#22c55e' },
]
export const NORM_BY_KEY = Object.fromEntries(NORM_STATUS.map((s) => [s.key, s]))

export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const isOverdue = (due, norm, today = todayISO()) => norm !== 'done' && !!due && due < today

const nowISO = () => new Date().toISOString()

export const SOURCES = [
  {
    key: 'incidents',
    label: 'Incident',
    tone: '#dc2626',
    collection: 'incidents',
    toNorm: (s) => (s === 'closed' ? 'done' : s === 'in_progress' ? 'in_progress' : 'open'),
    toNative: (n) => (n === 'done' ? 'closed' : n),
    extract: (d) =>
      (d.capa || []).filter(Boolean).map((a) => ({
        actionId: a.id,
        title: a.description || a.title || 'Corrective action',
        owner: a.owner || a.ownerName || a.responsible || '',
        due: a.dueDate || '',
        native: a.status || 'open',
        context: d.refNo || d.referenceNo || 'Incident',
        link: `/incidents/${d.id}`,
      })),
    write: async (orgId, action, native) => {
      const snap = await getDoc(dref(orgId, 'incidents', action.docId))
      if (!snap.exists()) throw new Error('Incident not found')
      const capa = (snap.data().capa || []).map((a) =>
        a.id === action.actionId ? { ...a, status: native, closedAt: native === 'closed' ? nowISO() : null } : a,
      )
      await updateDoc(dref(orgId, 'incidents', action.docId), { capa })
    },
  },
  {
    key: 'illness',
    label: 'Illness',
    tone: '#0891b2',
    collection: 'illnesses',
    toNorm: (s) => (s === 'closed' ? 'done' : s === 'in_progress' ? 'in_progress' : 'open'),
    toNative: (n) => (n === 'done' ? 'closed' : n),
    extract: (d) =>
      (d.actions || []).filter(Boolean).map((a) => ({
        actionId: a.id,
        title: a.description || a.title || 'Corrective action',
        owner: a.owner || a.ownerName || a.responsible || '',
        due: a.dueDate || '',
        native: a.status || 'open',
        context: d.refNo || 'Illness',
        link: `/incidents/illness/${d.id}`,
      })),
    write: async (orgId, action, native) => {
      const snap = await getDoc(dref(orgId, 'illnesses', action.docId))
      if (!snap.exists()) throw new Error('Illness record not found')
      const actions = (snap.data().actions || []).map((a) =>
        a.id === action.actionId ? { ...a, status: native, closedAt: native === 'closed' ? nowISO() : null } : a,
      )
      await updateDoc(dref(orgId, 'illnesses', action.docId), { actions })
    },
  },
  {
    key: 'equipment',
    label: 'Equipment',
    tone: '#ea580c',
    collection: 'extinguishers',
    toNorm: (s) => (s === 'closed' ? 'done' : s === 'in_progress' ? 'in_progress' : 'open'),
    toNative: (n) => (n === 'done' ? 'closed' : n),
    // An open physical defect on an extinguisher is a pending action. Interim
    // status lives in a defectStatuses map; marking Done resolves the defect
    // (removes it from the unit, same as the module's own Resolve).
    extract: (d) => {
      if (d.deletedAt) return []
      const labels = { pin: 'PIN', stand: 'Stand', hose_pipe: 'Hose Pipe Damage', handle: 'Handle Damage', empty: 'Empty', over_pressurized: 'Over Pressurized' }
      return (d.physicalDefects || []).map((k) => ({
        actionId: k,
        title: `Fix defect: ${labels[k] || k}`,
        owner: d.lastActionBy || '',
        due: '',
        native: (d.defectStatuses || {})[k] || 'open',
        context: `${d.serialNo || 'Extinguisher'}${d.centerName ? ` · ${d.centerName}` : ''}`,
        link: '/equipment/defects',
      }))
    },
    write: async (orgId, action, native) => {
      const snap = await getDoc(dref(orgId, 'extinguishers', action.docId))
      if (!snap.exists()) throw new Error('Extinguisher not found')
      const data = snap.data()
      const statuses = { ...(data.defectStatuses || {}) }
      if (native === 'closed') {
        const remaining = (data.physicalDefects || []).filter((k) => k !== action.actionId)
        delete statuses[action.actionId]
        await updateDoc(dref(orgId, 'extinguishers', action.docId), {
          physicalDefects: remaining, defectStatuses: statuses, quotation: null,
        })
      } else {
        statuses[action.actionId] = native
        await updateDoc(dref(orgId, 'extinguishers', action.docId), { defectStatuses: statuses })
      }
    },
  },
  {
    key: 'drills',
    label: 'Mock Drill',
    tone: '#7c3aed',
    collection: 'mockDrills',
    toNorm: (s) => (s === 'Closed' ? 'done' : s === 'In Progress' ? 'in_progress' : 'open'),
    toNative: (n) => (n === 'done' ? 'Closed' : n === 'in_progress' ? 'In Progress' : 'Open'),
    // Drill CAPA rows carry no stable id — index within the array is the handle.
    extract: (d) =>
      (d.capa || []).map((c, i) => ({
        actionId: i,
        title: c.action || 'CAPA action',
        owner: c.owner || '',
        due: c.due || '',
        native: c.status || 'Open',
        context: `${d.scenario || 'Drill'}${d.centerName ? ` · ${d.centerName}` : ''}`,
        link: '/mock-drills',
      })),
    write: async (orgId, action, native) => {
      const snap = await getDoc(dref(orgId, 'mockDrills', action.docId))
      if (!snap.exists()) throw new Error('Drill record not found')
      const capa = (snap.data().capa || []).map((c, i) =>
        i === action.actionId ? { ...c, status: native } : c,
      )
      await updateDoc(dref(orgId, 'mockDrills', action.docId), { capa })
    },
  },
  {
    key: 'inspections',
    label: 'Inspection',
    tone: '#0284c7',
    collection: 'inspectionRecords',
    toNorm: (s) => (s === 'closed' ? 'done' : s === 'in_progress' ? 'in_progress' : 'open'),
    toNative: (n) => (n === 'done' ? 'closed' : n),
    // A failed checklist item (answer === 'Fail') is a corrective action. Its
    // status is tracked on the response itself via an `actionStatus` field.
    extract: (d) =>
      Object.entries(d.responses || {})
        .filter(([, r]) => r && r.answer === 'Fail')
        .map(([fieldId, r]) => ({
          actionId: fieldId,
          title: `${r.label || 'Failed check'}${r.observation ? ` — ${r.observation}` : ''}`,
          owner: d.inspector || '',
          due: '',
          native: r.actionStatus || 'open',
          context: `${d.templateTitle || 'Inspection'}${d.siteName ? ` · ${d.siteName}` : ''}`,
          link: '/inspections/records',
        })),
    write: async (orgId, action, native) => {
      const snap = await getDoc(dref(orgId, 'inspectionRecords', action.docId))
      if (!snap.exists()) throw new Error('Inspection record not found')
      const responses = { ...(snap.data().responses || {}) }
      const r = responses[action.actionId]
      if (!r) throw new Error('Inspection item not found')
      responses[action.actionId] = { ...r, actionStatus: native, actionClosedAt: native === 'closed' ? nowISO() : null }
      await updateDoc(dref(orgId, 'inspectionRecords', action.docId), { responses })
    },
  },
  {
    key: 'audit',
    label: 'Internal Audit',
    tone: '#b45309',
    collection: 'auditFindings',
    // Findings carry no status of their own initially — fall back to the audit
    // record's lifecycle status, and store a per-finding status once tracked here.
    toNorm: (s) =>
      s === 'done' || s === 'Closed'
        ? 'done'
        : s === 'in_progress' || s === 'Submitted for Verification'
          ? 'in_progress'
          : 'open',
    toNative: (n) => n,
    extract: (d) =>
      (d.findings || []).filter(Boolean).map((f) => ({
        actionId: f.id,
        title: `${f.type || 'Finding'}: ${f.desc || f.description || 'Corrective action'}${f.clause ? ` (clause ${f.clause})` : ''}`,
        owner: d.taskDetails?.auditee || d.auditor || '',
        due: f.auditeeDueDate || '',
        native: f.status || d.status || 'Reported',
        context: `${d.docId || 'Audit'}${d.taskDetails?.dept ? ` · ${d.taskDetails.dept}` : ''}`,
        link: '/audit',
      })),
    write: async (orgId, action, native) => {
      const snap = await getDoc(dref(orgId, 'auditFindings', action.docId))
      if (!snap.exists()) throw new Error('Audit finding not found')
      const findings = (snap.data().findings || []).map((f) =>
        f.id === action.actionId ? { ...f, status: native } : f,
      )
      await updateDoc(dref(orgId, 'auditFindings', action.docId), { findings })
    },
  },
  {
    key: 'committee',
    label: 'Committee',
    tone: '#2563eb',
    collection: 'consultations',
    toNorm: (s) => (s === 'Closed' ? 'done' : s === 'In Progress' ? 'in_progress' : 'open'),
    toNative: (n) => (n === 'done' ? 'Closed' : n === 'in_progress' ? 'In Progress' : 'Open'),
    // Committee actions carry no stable id — index within the doc's array is the handle.
    extract: (d) =>
      (d.actions || []).map((a, i) => ({
        actionId: i,
        title: a.action || a.description || 'Action',
        owner: a.owner || '',
        due: a.due || '',
        native: a.status || 'Open',
        context: d.subject || d.docId || 'Meeting',
        link: '/committee',
      })),
    write: async (orgId, action, native) => {
      const snap = await getDoc(dref(orgId, 'consultations', action.docId))
      if (!snap.exists()) throw new Error('Meeting not found')
      const actions = (snap.data().actions || []).map((a, i) =>
        i === action.actionId ? { ...a, status: native } : a,
      )
      await updateDoc(dref(orgId, 'consultations', action.docId), { actions })
    },
  },
]

export const SOURCE_BY_KEY = Object.fromEntries(SOURCES.map((s) => [s.key, s]))

/**
 * Subscribe to every source collection and deliver one flat, normalized list of
 * action items. Returns an unsubscribe function.
 */
export function subscribeActions(orgId, cb) {
  const latest = {} // { [sourceKey]: docs[] }
  const emit = () => {
    const rows = []
    for (const src of SOURCES) {
      for (const d of latest[src.key] || []) {
        for (const a of src.extract(d)) {
          if (a.actionId === undefined || a.actionId === null) continue
          const norm = src.toNorm(a.native)
          rows.push({
            key: `${src.key}:${d.id}:${a.actionId}`,
            source: src.key,
            sourceLabel: src.label,
            tone: src.tone,
            docId: d.id,
            // Scope carried from the owning record so actions can be rolled up
            // by region / entity / site (Objectives & Targets).
            region: d.region || d.taskDetails?.region || '',
            entity: d.entity || d.taskDetails?.entity || '',
            siteId: d.siteId || d.taskDetails?.siteId || '',
            actionId: a.actionId,
            title: a.title,
            owner: a.owner,
            due: a.due,
            native: a.native,
            norm,
            overdue: isOverdue(a.due, norm),
            context: a.context,
            link: a.link,
          })
        }
      }
    }
    cb(rows)
  }
  // Shared listeners: these collections are already watched by their own
  // modules, so the tracker adds no extra reads when they're mounted too.
  const unsubs = SOURCES.map((src) =>
    subscribeOrgCollection(orgId, src.collection, (rows) => {
      latest[src.key] = rows
      emit()
    }),
  )
  return () => unsubs.forEach((u) => u())
}

/** Write a normalized status back into the originating source document. */
export async function updateActionStatus(orgId, action, normStatus) {
  const src = SOURCE_BY_KEY[action.source]
  if (!src) throw new Error(`Unknown source: ${action.source}`)
  await src.write(orgId, action, src.toNative(normStatus))
}
