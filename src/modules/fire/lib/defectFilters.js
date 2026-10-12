// ─────────────────────────────────────────────────────────────────────────────
// Client-side filters for the Defect Repository. Same model as listFilter.js
// (the shared repository filter bar): each chip field is an array — OR within
// a field, AND across fields, empty = no constraint — plus a free-text search
// and an optional date range over the row's reported date (or due date for
// derived HPT-due rows).
// ─────────────────────────────────────────────────────────────────────────────
import { format } from 'date-fns'
import { toDate } from './extinguisherLogic'

export const DEFECT_FILTER_FIELDS = ['kind', 'defect', 'source', 'status', 'region', 'entity', 'site']

export const SOURCE_LABEL = { recorded: 'Recorded', derived: 'Derived from register' }

export function emptyDefectFilters() {
  return { search: '', kind: [], defect: [], source: [], status: [], region: [], entity: [], site: [], from: '', to: '' }
}

const norm = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
const arr = (v) => (Array.isArray(v) ? v : v ? [v] : [])

export function hasActiveDefectFilters(f = {}) {
  if (f.search && f.search.trim()) return true
  if (f.from || f.to) return true
  return DEFECT_FILTER_FIELDS.some((k) => arr(f[k]).length > 0)
}

/** 'recorded' for filed defects / QR reports, 'derived' for register-derived rows. */
export const sourceOf = (row) => (row.source === 'derived' ? 'derived' : 'recorded')
export const statusOf = (row) => (row.source === 'asset' ? 'Pending confirmation' : 'Open')
/** The date a row is filtered on: reported date, else its due date. */
export const dateOf = (row) => toDate(row.reportedAt) || toDate(row.dueDate) || null

function match(selected, value) {
  const a = arr(selected)
  if (!a.length) return true
  const n = norm(value)
  return a.some((v) => norm(v) === n)
}

const dayStart = (s) => { const d = new Date(`${s}T00:00:00`); return Number.isNaN(d.getTime()) ? null : d }
const dayEnd = (s) => { const d = new Date(`${s}T23:59:59.999`); return Number.isNaN(d.getTime()) ? null : d }

export function applyDefectFilters(rows = [], f = {}) {
  const q = norm(f.search)
  const from = f.from ? dayStart(f.from) : null
  const to = f.to ? dayEnd(f.to) : null
  return rows.filter((row) => {
    if (q) {
      const hay = norm([row.label, row.assetId, row.sub, row.site, row.location, row.defect, row.kind, row.region, row.entity].join(' '))
      if (!hay.includes(q)) return false
    }
    if (!match(f.kind, row.kind)) return false
    if (!match(f.defect, row.defect)) return false
    if (!match(f.source, sourceOf(row))) return false
    if (!match(f.status, statusOf(row))) return false
    if (!match(f.region, row.region)) return false
    if (!match(f.entity, row.entity)) return false
    if (!match(f.site, row.site)) return false
    if (from || to) {
      const d = dateOf(row)
      if (!d) return false
      if (from && d < from) return false
      if (to && d > to) return false
    }
    return true
  })
}

const uniq = (vals) => [...new Set(vals.filter(Boolean))].sort((a, b) => a.localeCompare(b))

/** Chip options built from the rows actually on the list (already access-scoped). */
export function defectFieldDefs(rows = []) {
  const opts = (vals) => uniq(vals).map((v) => ({ value: v, label: v }))
  return {
    kind: { label: 'Equipment', options: opts(rows.map((r) => r.kind)) },
    defect: { label: 'Defect', options: opts(rows.map((r) => r.defect)) },
    source: { label: 'Source', options: Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label })) },
    status: { label: 'Status', options: opts(rows.map(statusOf)) },
    region: { label: 'Region', options: opts(rows.map((r) => r.region)) },
    entity: { label: 'Entity', options: opts(rows.map((r) => r.entity)) },
    site: { label: 'Site', options: opts(rows.map((r) => r.site)) },
  }
}

/** Short, filename-safe summary of the active filters ('' when none). */
export function defectFilterSlug(f = {}) {
  const parts = []
  for (const k of ['kind', 'defect', 'source', 'status', 'region', 'entity', 'site']) parts.push(...arr(f[k]))
  if (f.from) parts.push(`from-${f.from}`)
  if (f.to) parts.push(`to-${f.to}`)
  if (f.search && f.search.trim()) parts.push(`q-${f.search.trim()}`)
  const slug = parts.join('_').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
  return slug.slice(0, 60)
}

export function defectExportFilename(f = {}, now = new Date()) {
  const slug = hasActiveDefectFilters(f) ? defectFilterSlug(f) : ''
  return `equipment-defects-${slug ? `filtered-${slug}-` : ''}${format(now, 'yyyy-MM-dd')}.xlsx`
}
