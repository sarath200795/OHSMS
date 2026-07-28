import { useMemo, useState } from 'react'
import { Signpost, Plus, Pencil, Trash2, MapPin, X, LayoutGrid, List, Download, Check, Search, Filter } from 'lucide-react'
import toast from 'react-hot-toast'
import { PageHeader, EmptyState, Modal, Badge, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useFleet } from '../context/FleetContext'
import { addSignage, updateSignage, deleteSignage } from '../lib/firestore'
import { exportSignage } from '../lib/exporter'
import SiteScopePicker from '../../../shared/org/SiteScopePicker'
import {
  SIGNAGE_TYPES,
  SIGNAGE_CONDITIONS,
  SIGNAGE_CONDITION_COLOR,
  FLOOR_SIGNAGE_TYPES,
  REGIONS,
  ENTITIES,
} from '../lib/constants'

const EMPTY = {
  centerName: '',
  region: '',
  entity: '',
  siteId: '',
  site: '',
  type: 'Stretcher Signage',
  floor: '',
  location: '',
  condition: 'OK',
  quantity: 1,
  lastChecked: '',
  notes: '',
  // FERP floor coverage
  totalFloors: '',
  allFloors: true,
  floorsCovered: '',
}

const isFerp = (type) => FLOOR_SIGNAGE_TYPES.includes(type)
// Floors that have FERP, given a record.
const ferpCovered = (s) => (s.allFloors ? s.totalFloors || 0 : s.floorsCovered || 0)

// Conditions that mean the signage exists but needs attention.
const ISSUE_CONDITIONS = ['Faded', 'Damaged', 'Obstructed']

// Every fire extinguisher should have a "Fire Extinguisher Sign", so this
// column is scored against the number of extinguishers at the site (from the
// Repository) rather than mere presence.
const EXT_SIGN_TYPE = 'Fire Extinguisher Sign'

const EMPTY_FILTERS = { search: '', regions: [], entities: [], types: [], conditions: [] }

function Field({ label, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}

// One filter row of toggle chips (mirrors the Repository/Dashboard ListFilters style).
function ChipRow({ label, options, selected, onToggle }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
      <span className="w-20 shrink-0 text-xs font-bold uppercase tracking-wide text-ink-400">{label}</span>
      {options.map((opt) => {
        const on = selected.includes(opt)
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className={`chip transition ${on ? 'bg-brand-500 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'}`}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}

export default function Signages() {
  const { orgId, profile } = useAuth()
  const { signages, sites, extinguishers, siteInventory, loading } = useFleet()

  const [view, setView] = useState('matrix') // 'matrix' | 'list'
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [editing, setEditing] = useState(null) // signage object or {…EMPTY}
  const [removing, setRemoving] = useState(null)
  const [cellView, setCellView] = useState(null) // { site, type } — matrix cell detail panel
  const [busy, setBusy] = useState(false)

  const f = filters
  const anyActive = f.search || f.regions.length || f.entities.length || f.types.length || f.conditions.length
  const toggle = (field, value) =>
    setFilters((prev) => {
      const cur = prev[field]
      return { ...prev, [field]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] }
    })
  const clearFilters = () => setFilters(EMPTY_FILTERS)

  // Each site's region (from its extinguishers, then signage) — for the Region filter.
  const siteRegion = useMemo(() => {
    const m = {}
    for (const e of extinguishers) if (e.centerName && e.region && !m[e.centerName]) m[e.centerName] = e.region
    for (const s of signages) if (s.centerName && s.region && !m[s.centerName]) m[s.centerName] = s.region
    return m
  }, [extinguishers, signages])

  // How many extinguishers each site has (from the Repository) — the target
  // count of "Fire Extinguisher Sign" records for that site.
  const extCountBySite = useMemo(() => {
    const m = {}
    for (const e of extinguishers) {
      if (!e.centerName) continue
      m[e.centerName] = (m[e.centerName] || 0) + 1
    }
    return m
  }, [extinguishers])

  // Each site's entity (from its extinguishers, then signage) — for the Entity filter.
  const siteEntity = useMemo(() => {
    const m = {}
    for (const e of extinguishers) if (e.centerName && e.entity && !m[e.centerName]) m[e.centerName] = e.entity
    for (const s of signages) if (s.centerName && s.entity && !m[s.centerName]) m[s.centerName] = s.entity
    return m
  }, [extinguishers, signages])

  // Which signage types are shown as matrix columns (all, unless the Type filter narrows them).
  const visibleTypes = useMemo(
    () => (f.types.length ? SIGNAGE_TYPES.filter((t) => f.types.includes(t)) : SIGNAGE_TYPES),
    [f.types]
  )

  // Matrix rows: sites matching the Search + Region filters (kept even with no signage, so gaps show).
  const visibleSites = useMemo(() => {
    const q = f.search.trim().toLowerCase()
    return sites.filter((site) => {
      if (f.regions.length && !f.regions.includes(siteRegion[site])) return false
      if (f.entities.length && !f.entities.includes(siteEntity[site])) return false
      if (q) {
        const siteHit = site.toLowerCase().includes(q)
        const recHit = signages.some((s) => s.centerName === site && `${s.type} ${s.location}`.toLowerCase().includes(q))
        if (!siteHit && !recHit) return false
      }
      return true
    })
  }, [sites, signages, f.regions, f.entities, f.search, siteRegion, siteEntity])

  // List records: every record matching all active filters.
  const recordMatches = (s) => {
    if (f.regions.length && !f.regions.includes(s.region)) return false
    if (f.entities.length && !f.entities.includes(s.entity || siteEntity[s.centerName])) return false
    if (f.types.length && !f.types.includes(s.type)) return false
    if (f.conditions.length && !f.conditions.includes(s.condition)) return false
    if (f.search) {
      const q = f.search.trim().toLowerCase()
      if (!`${s.centerName} ${s.type} ${s.location}`.toLowerCase().includes(q)) return false
    }
    return true
  }
  const filtered = useMemo(() => signages.filter(recordMatches), [signages, filters])

  // A matrix cell: records for (site, type) that pass the Region + Condition filters.
  const cellFor = (site, type) => {
    let recs = signages.filter((s) => s.centerName === site && s.type === type)
    if (f.regions.length) recs = recs.filter((r) => f.regions.includes(r.region))
    if (f.entities.length) recs = recs.filter((r) => f.entities.includes(r.entity || siteEntity[site]))
    if (f.conditions.length) recs = recs.filter((r) => f.conditions.includes(r.condition))

    // Fire-extinguisher signage is scored against the site's extinguisher count:
    // recorded signs (sum of quantities, excluding "Missing") vs required (# units).
    if (type === EXT_SIGN_TYPE) {
      const required = extCountBySite[site] || 0
      const present = recs.filter((r) => r.condition !== 'Missing')
      const recorded = present.reduce((a, r) => a + (Number(r.quantity) || 1), 0)
      if (recs.length === 0 && required === 0) return { count: 0, status: 'none' }
      let status
      if (required === 0) status = recorded > 0 ? 'ok' : 'none'
      else if (recorded === 0) status = 'missing'
      else if (recorded < required) status = 'issue'
      else status = 'ok'
      if (status === 'ok' && present.some((r) => ISSUE_CONDITIONS.includes(r.condition))) status = 'issue'
      const label = required > 0 ? `${recorded}/${required}` : (recorded > 0 ? String(recorded) : '—')
      return { count: recs.length, status, label }
    }

    if (recs.length === 0) return { count: 0, status: 'none' }
    // FERP shows floor coverage (covered / total) rather than a plain count.
    if (isFerp(type)) {
      const rec = recs.reduce((a, b) => ((b.totalFloors || 0) > (a.totalFloors || 0) ? b : a), recs[0])
      const total = rec.totalFloors || 0
      const covered = ferpCovered(rec)
      const missing = recs.some((r) => r.condition === 'Missing')
      let status = 'ok'
      if (missing || covered === 0) status = 'missing'
      else if (total > 0 && covered < total) status = 'issue'
      return { count: recs.length, status, label: total > 0 ? `${covered}/${total}` : '✓' }
    }
    if (recs.some((r) => r.condition === 'Missing')) return { count: recs.length, status: 'missing' }
    if (recs.some((r) => ISSUE_CONDITIONS.includes(r.condition))) return { count: recs.length, status: 'issue' }
    return { count: recs.length, status: 'ok' }
  }

  // A type counts toward a site's coverage when its cell is satisfied. The
  // fire-extinguisher column requires a FULL match to the fleet (status 'ok'),
  // not mere presence.
  const isTypeCovered = (type, cell) =>
    type === EXT_SIGN_TYPE ? cell.status === 'ok' : cell.count > 0

  // Group filtered records by site for the list view.
  const grouped = useMemo(() => {
    const map = new Map()
    for (const s of filtered) {
      const key = s.centerName || 'Unassigned'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(s)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  const set = (k) => (e) => setEditing({ ...editing, [k]: e.target.value })
  const openAddFor = (centerName, type) => {
    // Prefill the correlated picker from the registered site when the group name
    // matches a known site; otherwise keep the (legacy) name as the site value.
    const s = siteInventory.find((x) => x.name === centerName)
    setEditing({
      ...EMPTY,
      type,
      centerName: centerName || '',
      site: s?.name || centerName || '',
      siteId: s?.id || '',
      region: s?.region || '',
      entity: s?.entity || '',
    })
  }

  const save = async (e) => {
    e.preventDefault()
    if (!editing.centerName.trim()) return toast.error('Site is required')
    const payload = { ...editing }
    if (isFerp(payload.type)) {
      const total = Number(payload.totalFloors) || 0
      if (total < 1) return toast.error('Enter the number of floors for FERP')
      payload.totalFloors = total
      payload.floorsCovered = payload.allFloors ? total : Math.min(Number(payload.floorsCovered) || 0, total)
    } else {
      payload.totalFloors = 0
      payload.allFloors = false
      payload.floorsCovered = 0
    }
    setBusy(true)
    try {
      const actor = { uid: profile?.uid, name: profile?.name }
      if (editing.id) {
        await updateSignage(orgId, editing.id, payload, actor)
        toast.success('Signage updated')
      } else {
        await addSignage(orgId, payload, actor)
        toast.success('Signage added')
      }
      setEditing(null)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    try {
      await deleteSignage(orgId, removing.id, { uid: profile?.uid, name: profile?.name }, `${removing.type} @ ${removing.centerName}`)
      toast.success('Signage deleted')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setRemoving(null)
    }
  }

  // ── Export: a matrix sheet (counts) + a details sheet (every record) — both respect filters ──
  const handleExport = () => {
    const matrixRows = visibleSites.map((site) => {
      const row = { Site: site, Region: siteRegion[site] || '', Entity: siteEntity[site] || '' }
      let covered = 0
      for (const t of visibleTypes) {
        const c = cellFor(site, t)
        if (isTypeCovered(t, c)) covered++
        row[t] = t === EXT_SIGN_TYPE && c.label ? c.label : c.count
      }
      row.Coverage = `${covered}/${visibleTypes.length}`
      return row
    })
    const detailRows = filtered
      .slice()
      .sort((a, b) => (a.centerName || '').localeCompare(b.centerName || '') || a.type.localeCompare(b.type))
      .map((s) => ({
        Site: s.centerName || '',
        Region: s.region || '',
        Entity: s.entity || siteEntity[s.centerName] || '',
        Type: s.type,
        Floor: isFerp(s.type) ? (s.totalFloors ? `${ferpCovered(s)}/${s.totalFloors}` : '') : (s.floor || ''),
        Location: s.location || '',
        Condition: s.condition || '',
        Quantity: s.quantity ?? '',
        'Last Checked': s.lastChecked || '',
        Notes: s.notes || '',
      }))
    if (matrixRows.length === 0) return toast.error('No sites to export')
    exportSignage(matrixRows, detailRows, 'fire-marshal-safety-signage.xlsx')
    toast.success('Exported to Excel')
  }

  const cellStyles = {
    none: 'bg-clay-50 text-ink-300',
    ok: 'bg-green-50 text-green-700',
    issue: 'bg-amber-50 text-amber-700',
    missing: 'bg-red-50 text-red-700',
  }

  return (
    <div>
      <PageHeader title="Safety Signage" subtitle="Site-wise availability of fire & safety signage" icon={Signpost}>
        <div className="flex rounded-xl bg-clay-100 p-1">
          <button onClick={() => setView('matrix')} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold ${view === 'matrix' ? 'bg-white text-ink-900 shadow-clay-sm' : 'text-ink-500'}`}><LayoutGrid size={14} /> Matrix</button>
          <button onClick={() => setView('list')} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold ${view === 'list' ? 'bg-white text-ink-900 shadow-clay-sm' : 'text-ink-500'}`}><List size={14} /> List</button>
        </div>
        <button className="btn-soft" onClick={handleExport} disabled={loading || sites.length === 0}><Download size={16} /> Export</button>
        <button className="btn-primary" onClick={() => setEditing({ ...EMPTY })}><Plus size={16} /> Add signage</button>
      </PageHeader>

      {/* Filters — same chip style as the Dashboard / Repository */}
      {!loading && sites.length > 0 && (
        <div className="card mb-4 space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-ink-400"><Filter size={13} /> Filters</span>
            <div className="relative min-w-[200px] flex-1">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input className="input pl-9" placeholder="Search site, type or location…" value={f.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
            </div>
            {anyActive ? <button className="btn-ghost" onClick={clearFilters}><X size={15} /> Clear</button> : null}
          </div>
          <ChipRow label="Region" options={REGIONS} selected={f.regions} onToggle={(v) => toggle('regions', v)} />
          <ChipRow label="Entity" options={ENTITIES} selected={f.entities} onToggle={(v) => toggle('entities', v)} />
          <ChipRow label="Type" options={SIGNAGE_TYPES} selected={f.types} onToggle={(v) => toggle('types', v)} />
          <ChipRow label="Condition" options={SIGNAGE_CONDITIONS} selected={f.conditions} onToggle={(v) => toggle('conditions', v)} />
        </div>
      )}

      {loading ? (
        <div className="grid place-items-center py-20"><Spinner size={28} /></div>
      ) : sites.length === 0 ? (
        <EmptyState
          icon={Signpost}
          title="No sites yet"
          hint="Add a site's first extinguisher or signage record, then track signage availability here."
          action={<button className="btn-primary" onClick={() => setEditing({ ...EMPTY })}><Plus size={16} /> Add signage</button>}
        />
      ) : view === 'matrix' ? (
        visibleSites.length === 0 ? (
          <EmptyState icon={Filter} title="No sites match your filters" hint="Try clearing or widening the filters above." action={<button className="btn-ghost" onClick={clearFilters}><X size={15} /> Clear filters</button>} />
        ) : (
        <>
          {/* Legend */}
          <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-ink-500">
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-green-200" /> Available</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-amber-200" /> Needs attention</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-red-200" /> Missing</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-clay-200" /> Not recorded</span>
            <span className="ml-auto text-ink-400">🧯 column shows signs / extinguishers — they should match. Click a cell to manage records.</span>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 border-b border-clay-200/60 bg-clay-surface px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-ink-500">Site</th>
                  {visibleTypes.map((t) => (
                    <th
                      key={t}
                      title={t === EXT_SIGN_TYPE ? 'Recorded signs / fire extinguishers at the site — these should match' : undefined}
                      className="border-b border-clay-200/60 bg-clay-surface px-2 py-3 text-center text-[10px] font-semibold leading-tight text-ink-500"
                      style={{ minWidth: 78 }}
                    >
                      {t}{t === EXT_SIGN_TYPE ? ' 🧯' : ''}
                    </th>
                  ))}
                  <th className="border-b border-clay-200/60 bg-clay-surface px-3 py-3 text-center text-[10px] font-bold uppercase tracking-wide text-ink-500" style={{ minWidth: 78 }}>Coverage</th>
                </tr>
              </thead>
              <tbody>
                {visibleSites.map((site) => {
                  let covered = 0
                  const cells = visibleTypes.map((t) => {
                    const c = cellFor(site, t)
                    if (isTypeCovered(t, c)) covered++
                    return { t, ...c }
                  })
                  const pct = Math.round((covered / visibleTypes.length) * 100)
                  return (
                    <tr key={site} className="group">
                      <td className="sticky left-0 z-10 border-b border-clay-200/40 bg-white px-4 py-2 font-semibold text-ink-800 group-hover:bg-clay-50">
                        <span className="flex items-center gap-1.5"><MapPin size={13} className="text-brand-400" /> {site}</span>
                      </td>
                      {cells.map((c) => (
                        <td key={c.t} className="border-b border-l border-clay-200/40 p-1 text-center">
                          <button
                            onClick={() => (c.count > 0 ? setCellView({ site, type: c.t }) : openAddFor(site, c.t))}
                            title={c.count > 0 ? `${c.count} record(s) — click to manage` : 'Not recorded — click to add'}
                            className={`flex h-9 w-full items-center justify-center gap-1 rounded-lg text-xs font-bold transition hover:ring-2 hover:ring-brand-200 ${cellStyles[c.status]}`}
                          >
                            {c.status === 'none' ? '—' : c.label ? <span>{c.label}</span> : c.status === 'missing' ? <X size={14} /> : <Check size={14} />}
                            {!c.label && c.count > 1 && <span>{c.count}</span>}
                          </button>
                        </td>
                      ))}
                      <td className="border-b border-l border-clay-200/40 px-3 py-2 text-center">
                        <span className={`font-bold ${pct >= 80 ? 'text-green-700' : pct >= 40 ? 'text-amber-700' : 'text-red-700'}`}>{covered}/{visibleTypes.length}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
        )
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Signpost}
          title="No signage matches"
          hint="Adjust the filters above, or add fire-safety signs for your sites."
          action={<button className="btn-primary" onClick={() => setEditing({ ...EMPTY })}><Plus size={16} /> Add signage</button>}
        />
      ) : (
        <div className="space-y-6">
          {grouped.map(([site, items]) => (
            <div key={site}>
              <div className="mb-2 flex items-center gap-2 px-1">
                <MapPin size={15} className="text-brand-500" />
                <h3 className="text-sm font-extrabold text-ink-800">{site}</h3>
                <span className="chip bg-ink-100 text-ink-500">{items.length}</span>
              </div>
              <div className="card overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-clay-200/60 text-[11px] uppercase tracking-wide text-ink-400">
                    <tr>
                      <th className="px-4 py-2.5">Type</th>
                      <th className="px-4 py-2.5">Floor</th>
                      <th className="px-4 py-2.5">Location</th>
                      <th className="px-4 py-2.5">Qty</th>
                      <th className="px-4 py-2.5">Condition</th>
                      <th className="px-4 py-2.5">Last checked</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-clay-200/50">
                    {items.map((s) => (
                      <tr key={s.id} className="hover:bg-clay-50">
                        <td className="px-4 py-2.5 font-semibold text-ink-800">{s.type}</td>
                        <td className="px-4 py-2.5 text-ink-500">{isFerp(s.type) ? (s.totalFloors ? `${ferpCovered(s)}/${s.totalFloors} floors` : '—') : (s.floor || '—')}</td>
                        <td className="px-4 py-2.5 text-ink-500">{s.location || '—'}</td>
                        <td className="px-4 py-2.5 text-ink-600">{s.quantity}</td>
                        <td className="px-4 py-2.5">
                          <Badge color={SIGNAGE_CONDITION_COLOR[s.condition] || '#64748b'}>{s.condition}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-ink-500">{s.lastChecked || '—'}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end gap-1">
                            <button className="btn-soft px-2 py-1.5" onClick={() => setEditing(s)} title="Edit"><Pencil size={15} /></button>
                            <button className="btn-soft px-2 py-1.5 text-red-600" onClick={() => setRemoving(s)} title="Delete"><Trash2 size={15} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / edit modal */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit signage' : 'Add signage'}>
        {editing && (
          <form onSubmit={save} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">Site — Region · Entity · Site</label>
                <SiteScopePicker
                  module="equipment"
                  sites={siteInventory}
                  value={editing}
                  onChange={(v) => setEditing((p) => ({ ...p, ...v, centerName: v.site }))}
                />
              </div>
              <Field label="Signage type">
                <select className="input" value={editing.type} onChange={set('type')}>
                  {SIGNAGE_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
              {isFerp(editing.type) ? (
                <Field label="Number of floors">
                  <input type="number" min={1} className="input" placeholder="e.g. 8" value={editing.totalFloors} onChange={set('totalFloors')} />
                </Field>
              ) : (
                <Field label="Floor (optional)">
                  <input className="input" placeholder="e.g. Ground, 1, 2, Basement" value={editing.floor} onChange={set('floor')} />
                </Field>
              )}
              <Field label="Condition">
                <select className="input" value={editing.condition} onChange={set('condition')}>
                  {SIGNAGE_CONDITIONS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Location / placement">
                <input className="input" placeholder="e.g. Above stairwell C door" value={editing.location} onChange={set('location')} />
              </Field>
              <Field label="Quantity">
                <input type="number" min={1} className="input" value={editing.quantity} onChange={set('quantity')} />
              </Field>
              <Field label="Last checked">
                <input type="date" className="input" value={editing.lastChecked} onChange={set('lastChecked')} />
              </Field>
            </div>
            {isFerp(editing.type) && (
              <div className="rounded-xl bg-clay-surface/60 p-3 shadow-clay-inset">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink-700">
                  <input type="checkbox" checked={!!editing.allFloors} onChange={(e) => setEditing({ ...editing, allFloors: e.target.checked })} />
                  FERP available on all floors
                </label>
                {!editing.allFloors && (
                  <div className="mt-2 max-w-[240px]">
                    <label className="label">Floors with FERP available</label>
                    <input type="number" min={0} max={editing.totalFloors || undefined} className="input" placeholder="e.g. 6" value={editing.floorsCovered} onChange={set('floorsCovered')} />
                  </div>
                )}
                <p className="mt-2 text-xs text-ink-400">A Fire Emergency Response Plan should be displayed on every floor.</p>
              </div>
            )}
            {editing.type === EXT_SIGN_TYPE && editing.centerName.trim() && (() => {
              const site = editing.centerName.trim()
              const required = extCountBySite[site] || 0
              const others = signages
                .filter((s) => s.centerName === site && s.type === EXT_SIGN_TYPE && s.condition !== 'Missing' && s.id !== editing.id)
                .reduce((a, s) => a + (Number(s.quantity) || 1), 0)
              const withThis = others + (Number(editing.quantity) || 0)
              return (
                <div className="rounded-xl bg-brand-50 p-3 text-xs text-ink-600">
                  🧯 <strong>{site}</strong> has <strong>{required}</strong> fire extinguisher(s) in the Repository.
                  {required > 0 ? (
                    <> With this record you’ll have <strong>{withThis}</strong> sign(s) here — {withThis >= required ? 'that matches the fleet ✅' : `${required - withThis} more needed to match.`}</>
                  ) : (
                    <> Add extinguishers to the Repository to track sign coverage.</>
                  )}
                </div>
              )
            })()}
            <Field label="Notes">
              <textarea className="input" rows={2} value={editing.notes} onChange={set('notes')} />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? <Spinner size={16} /> : (editing.id ? 'Save changes' : 'Add signage')}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Delete confirm */}
      <Modal open={!!removing} onClose={() => setRemoving(null)} title="Delete signage?">
        <p className="text-sm text-ink-600">
          Remove <span className="font-semibold">{removing?.type}</span> at{' '}
          <span className="font-semibold">{removing?.centerName}</span>? This can’t be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setRemoving(null)}>Cancel</button>
          <button className="btn-danger" onClick={confirmDelete}>Delete</button>
        </div>
      </Modal>

      {/* Matrix cell — manage this site's records for one signage type */}
      <Modal open={!!cellView} onClose={() => setCellView(null)} title={cellView ? `${cellView.type} · ${cellView.site}` : ''}>
        {cellView && (() => {
          const recs = signages.filter((s) => s.centerName === cellView.site && s.type === cellView.type)
          return (
            <div>
              {recs.length === 0 ? (
                <p className="text-sm text-ink-500">No records left for this sign at this site.</p>
              ) : (
                <ul className="space-y-2">
                  {recs.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 rounded-xl border border-clay-200/60 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge color={SIGNAGE_CONDITION_COLOR[s.condition] || '#64748b'}>{s.condition}</Badge>
                          {isFerp(s.type) && s.totalFloors ? (
                            <span className="text-xs text-ink-500">{ferpCovered(s)}/{s.totalFloors} floors</span>
                          ) : s.floor ? (
                            <span className="text-xs text-ink-500">Floor {s.floor}</span>
                          ) : null}
                          <span className="text-xs text-ink-400">Qty {s.quantity}</span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-ink-500">
                          {s.location || 'No location'}{s.lastChecked ? ` · checked ${s.lastChecked}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button className="btn-soft px-2 py-1.5" title="Edit" onClick={() => { setEditing(s); setCellView(null) }}><Pencil size={15} /></button>
                        <button className="btn-soft px-2 py-1.5 text-red-600" title="Remove (damaged / removed)" onClick={() => setRemoving(s)}><Trash2 size={15} /></button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 flex justify-end gap-2 border-t border-clay-200/60 pt-3">
                <button className="btn-ghost" onClick={() => setCellView(null)}>Close</button>
                <button className="btn-primary" onClick={() => { openAddFor(cellView.site, cellView.type); setCellView(null) }}>
                  <Plus size={16} /> Add another
                </button>
              </div>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}
