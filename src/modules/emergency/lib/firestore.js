// ─────────────────────────────────────────────────────────────────────────────
// Emergency Response (FERP) data layer — the emergency contact directory.
//   organizations/{orgId}/erpContacts
// External contacts (Police, Ambulance, Fire Brigade, …) and internal
// escalation contacts (CM, CLM, Safety L1/L2, Legal, HR), scoped to sites via
// the org's granularity model.
// ─────────────────────────────────────────────────────────────────────────────
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore'
import { db } from '../../../shared/firebase'
import { logAudit } from '../../../shared/org/orgData'

const col = (orgId) => collection(db, 'organizations', orgId, 'erpContacts')
const ref = (orgId, id) => doc(db, 'organizations', orgId, 'erpContacts', id)

export const EXTERNAL_ROLES = [
  'Police', 'Ambulance', 'Fire Brigade', 'Hospital', 'Helpline', 'Electricity Board',
  'Gas Emergency', 'Pollution Control', 'Other',
]
export const INTERNAL_ROLES = [
  'CM', 'CLM', 'Safety L1', 'Safety L2', 'Legal', 'HR', 'Security', 'First Aider', 'Other',
]

export function subscribeContacts(orgId, cb) {
  const q = query(col(orgId), orderBy('role'))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}

const clean = (data) => ({
  kind: data.kind === 'internal' ? 'internal' : 'external',
  role: (data.role || '').trim() || 'Other',
  name: (data.name || '').trim(),
  phone: (data.phone || '').trim(),
  altPhone: (data.altPhone || '').trim(),
  email: (data.email || '').trim(),
  employeeUid: data.employeeUid || '',
  department: data.department || '',
  region: data.region || '',
  entity: data.entity || '',
  siteId: data.siteId || '',
  site: data.site || '',
  notes: (data.notes || '').trim(),
})

export async function addContact(orgId, data, actor) {
  const r = await addDoc(col(orgId), { ...clean(data), createdAt: serverTimestamp(), createdBy: actor?.uid || null })
  await logAudit(orgId, actor, 'erp.contact_create', {
    module: 'emergency', target: 'contact', targetId: r.id, targetLabel: `${data.role} · ${data.name}`,
    summary: `Added ${data.kind} emergency contact "${data.name}" (${data.role})`,
  })
  return r.id
}

export async function updateContact(orgId, id, data, actor) {
  await updateDoc(ref(orgId, id), { ...clean(data), updatedAt: serverTimestamp() })
  await logAudit(orgId, actor, 'erp.contact_update', {
    module: 'emergency', target: 'contact', targetId: id, targetLabel: `${data.role} · ${data.name}`,
    summary: `Updated emergency contact "${data.name}"`,
  })
}

export async function deleteContact(orgId, id, actor, label) {
  await deleteDoc(ref(orgId, id))
  await logAudit(orgId, actor, 'erp.contact_delete', {
    module: 'emergency', target: 'contact', targetId: id, targetLabel: label,
    summary: `Removed emergency contact "${label}"`,
  })
}

// ── Evacuation layouts (one doc per site, keyed by siteId) ───────────────────
// Kept out of the site registry docs so the app-wide sites listener stays light.
const layoutRef = (orgId, siteId) => doc(db, 'organizations', orgId, 'erpLayouts', siteId)
const layoutCol = (orgId) => collection(db, 'organizations', orgId, 'erpLayouts')

export function subscribeLayouts(orgId, cb) {
  return onSnapshot(
    layoutCol(orgId),
    (s) => cb(Object.fromEntries(s.docs.map((d) => [d.id, d.data()]))),
    () => cb({})
  )
}

export async function saveLayout(orgId, site, { dataUrl, fileName }, actor) {
  await setDoc(layoutRef(orgId, site.id), {
    siteId: site.id,
    siteName: site.name,
    dataUrl,
    fileName: fileName || '',
    updatedAt: serverTimestamp(),
    updatedBy: actor?.uid || null,
    updatedByName: actor?.name || '',
  })
  await logAudit(orgId, actor, 'erp.layout_save', {
    module: 'emergency', target: 'layout', targetId: site.id, targetLabel: site.name,
    summary: `Uploaded emergency evacuation layout for ${site.name}`,
  })
}

export async function deleteLayout(orgId, site, actor) {
  await deleteDoc(layoutRef(orgId, site.id))
  await logAudit(orgId, actor, 'erp.layout_delete', {
    module: 'emergency', target: 'layout', targetId: site.id, targetLabel: site.name,
    summary: `Removed emergency evacuation layout for ${site.name}`,
  })
}

// ── Emergency rescue plans (per site, per scenario) ─────────────────────────
const planCol = (orgId) => collection(db, 'organizations', orgId, 'erpRescuePlans')
const planRef = (orgId, id) => doc(db, 'organizations', orgId, 'erpRescuePlans', id)

/** Scenarios a site plans a rescue response for. */
export const RESCUE_SCENARIOS = [
  'Fire / Explosion',
  'Medical Emergency',
  'Chemical Spill / Release',
  'Gas Leak',
  'Electrical Incident',
  'Confined Space Rescue',
  'Work at Height Rescue',
  'Machine Entrapment',
  'Water / Drowning Rescue',
  'Structural Collapse',
  'Natural Disaster',
  'Security Threat',
  'Other',
]

export const PLAN_STATUS = [
  { key: 'draft', label: 'Draft', tone: 'gray' },
  { key: 'approved', label: 'Approved', tone: 'green' },
  { key: 'review_due', label: 'Review due', tone: 'amber' },
]

export function subscribeRescuePlans(orgId, cb) {
  const q = query(planCol(orgId), orderBy('scenario'))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}

const cleanPlan = (data) => ({
  siteId: data.siteId || '',
  siteName: data.siteName || '',
  region: data.region || '',
  entity: data.entity || '',
  scenario: data.scenario || 'Other',
  title: (data.title || '').trim(),
  description: (data.description || '').trim(),
  triggers: (data.triggers || '').trim(),
  assemblyPoint: (data.assemblyPoint || '').trim(),
  steps: (Array.isArray(data.steps) ? data.steps : [])
    .filter((s) => (s.action || '').trim())
    .map((s, i) => ({
      id: s.id || `st-${i}`,
      order: i + 1,
      action: s.action.trim(),
      responsible: (s.responsible || '').trim(),
    })),
  team: (Array.isArray(data.team) ? data.team : [])
    .filter((t) => (t.name || '').trim() || (t.role || '').trim())
    .map((t, i) => ({
      id: t.id || `tm-${i}`,
      role: (t.role || '').trim(),
      name: (t.name || '').trim(),
      phone: (t.phone || '').trim(),
      uid: t.uid || '',
    })),
  equipment: (Array.isArray(data.equipment) ? data.equipment : []).filter(Boolean),
  status: data.status || 'draft',
  reviewedOn: data.reviewedOn || '',
  nextReviewOn: data.nextReviewOn || '',
})

export async function addRescuePlan(orgId, data, actor) {
  const r = await addDoc(planCol(orgId), {
    ...cleanPlan(data), createdAt: serverTimestamp(), createdBy: actor?.uid || null, createdByName: actor?.name || '',
  })
  await logAudit(orgId, actor, 'erp.plan_create', {
    module: 'emergency', target: 'rescuePlan', targetId: r.id, targetLabel: `${data.siteName} · ${data.scenario}`,
    summary: `Created rescue plan "${data.title}" (${data.scenario}) for ${data.siteName}`,
  })
  return r.id
}

export async function updateRescuePlan(orgId, id, data, actor) {
  await updateDoc(planRef(orgId, id), { ...cleanPlan(data), updatedAt: serverTimestamp() })
  await logAudit(orgId, actor, 'erp.plan_update', {
    module: 'emergency', target: 'rescuePlan', targetId: id, targetLabel: `${data.siteName} · ${data.scenario}`,
    summary: `Updated rescue plan "${data.title}" for ${data.siteName}`,
  })
}

export async function deleteRescuePlan(orgId, id, actor, label) {
  await deleteDoc(planRef(orgId, id))
  await logAudit(orgId, actor, 'erp.plan_delete', {
    module: 'emergency', target: 'rescuePlan', targetId: id, targetLabel: label,
    summary: `Deleted rescue plan "${label}"`,
  })
}
