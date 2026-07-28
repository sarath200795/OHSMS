import { useMemo, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { HeartPulse, Plus, Pencil, Trash2, Search, Filter, X, Download, QrCode, Wrench, Upload, AlertTriangle } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import toast from 'react-hot-toast'
import { PageHeader, EmptyState, Modal, Badge, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useFleet } from '../context/FleetContext'
import { addAed, updateAed, deleteAed, serviceAed, bulkAddAeds, generateAedQr, bulkDeleteAeds } from '../lib/firestore'
import { exportRows } from '../lib/exporter'
import { publicQrUrl } from '../lib/qr'
import SiteScopePicker from '../../../shared/org/SiteScopePicker'
import { format } from 'date-fns'
import { dueState, aedColor, aedIncomplete, nextAssetId, highestAssetSeq, formatAssetId } from '../lib/assetLogic'
import { toDate } from '../lib/extinguisherLogic'
import { REGIONS, ENTITIES, AED_STATUS, AED_STATUS_LABEL, AED_STATUS_COLOR } from '../lib/constants'

// Build site → {region, entity} from existing records so AED sites auto-fill.
function useSiteMeta() {
  const { extinguishers, signages, aeds, fas } = useFleet()
  return useMemo(() => {
    const m = {}
    const add = (rows) => rows.forEach((r) => {
      const s = r.centerName
      if (!s) return
      if (!m[s]) m[s] = { region: '', entity: '' }
      if (!m[s].region && r.region) m[s].region = r.region
      if (!m[s].entity && r.entity) m[s].entity = r.entity
    })
    add(extinguishers || []); add(signages || []); add(aeds || []); add(fas || [])
    return m
  }, [extinguishers, signages, aeds, fas])
}

const fmtDate = (v) => { const d = toDate(v); return d ? format(d, 'dd MMM yyyy') : String(v || '') }

const EMPTY = {
  assetId: '', brand: '', model: '', centerName: '', region: '', entity: '', siteId: '', location: '',
  status: AED_STATUS.READY, installDate: '', batteryExpiry: '', padExpiry: '',
  lastInspection: '', nextInspection: '', notes: '',
}
const PAGE_SIZE = 20
const STATUSES = Object.values(AED_STATUS)

function Field({ label, children }) {
  return <div><label className="label">{label}</label>{children}</div>
}
function ChipRow({ label, options, selected, onToggle, render }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
      <span className="w-16 shrink-0 text-xs font-bold uppercase tracking-wide text-ink-400">{label}</span>
      {options.map((opt) => {
        const on = selected.includes(opt)
        return (
          <button key={opt} type="button" onClick={() => onToggle(opt)}
            className={`chip transition ${on ? 'bg-brand-500 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'}`}>
            {render ? render(opt) : opt}
          </button>
        )
      })}
    </div>
  )
}
// Date cell that highlights when a date is expired / due soon.
function DateCell({ value }) {
  const s = dueState(value)
  if (!value) return <span className="text-ink-300">—</span>
  const color = s === 'expired' ? '#dc2626' : s === 'due' ? '#f59e0b' : '#64748b'
  return <span style={{ color }} className="font-medium">{fmtDate(value)}</span>
}

export default function AEDRepository() {
  const { orgId, orgName, profile, isAdmin } = useAuth()
  const { aeds, sites, siteInventory, loading } = useFleet()
  const siteMeta = useSiteMeta()
  const today = useMemo(() => new Date(), [])

  const [f, setF] = useState({ search: '', regions: [], entities: [], statuses: [] })
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [qrFor, setQrFor] = useState(null)
  const [serviceFor, setServiceFor] = useState(null)
  const [nextDate, setNextDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [bulkRemoving, setBulkRemoving] = useState(false)

  // Only offer sites that belong to the 1P / 2P entities.
  const pickSites = useMemo(() => sites.filter((s) => ['1P', '2P'].includes(siteMeta[s]?.entity)), [sites, siteMeta])

  // 1P/2P sites that don't yet have an AED — used by the auto-generate action.
  const missingSites = useMemo(() => {
    const have = new Set(aeds.map((a) => a.centerName))
    return pickSites.filter((s) => !have.has(s))
  }, [pickSites, aeds])

  // Open the Add form with the next unique asset ID pre-assigned.
  const openAdd = () => setEditing({ ...EMPTY, assetId: nextAssetId('AED', aeds, 'assetId') })

  // One-click (admin): create an AED (with QR code) for every 1P/2P site missing one.
  const generateAll = async () => {
    if (!missingSites.length) return
    if (!window.confirm(`Generate an AED with a QR code for ${missingSites.length} site(s)? You can add battery/pad expiry dates afterwards.`)) return
    setBusy(true)
    try {
      const base = highestAssetSeq('AED', aeds, 'assetId')
      const rows = missingSites.map((s, i) => ({ assetId: formatAssetId('AED', base + 1 + i), centerName: s, region: siteMeta[s]?.region || '', entity: siteMeta[s]?.entity || '', status: AED_STATUS.READY }))
      const res = await bulkAddAeds(orgId, orgName, rows, { uid: profile?.uid, name: profile?.name })
      toast.success(`Generated ${res.created} AED(s) with QR codes`)
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const toggle = (field, v) => setF((p) => ({ ...p, [field]: p[field].includes(v) ? p[field].filter((x) => x !== v) : [...p[field], v] }))
  const anyActive = f.search || f.regions.length || f.entities.length || f.statuses.length
  const clear = () => setF({ search: '', regions: [], entities: [], statuses: [] })

  const visible = useMemo(() => {
    const q = f.search.trim().toLowerCase()
    return aeds.filter((a) => {
      if (f.regions.length && !f.regions.includes(a.region)) return false
      if (f.entities.length && !f.entities.includes(a.entity)) return false
      if (f.statuses.length && !f.statuses.includes(a.status)) return false
      if (q && !`${a.assetId} ${a.brand} ${a.model} ${a.centerName} ${a.location}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [aeds, f])

  useEffect(() => { setPage(1); setSelected(new Set()) }, [f])
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageItems = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // ── Row selection + bulk delete ──
  const toggleSel = (id) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const pageIds = pageItems.map((a) => a.id)
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const toggleAllOnPage = () => setSelected((prev) => {
    const n = new Set(prev)
    if (allOnPage) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id))
    return n
  })
  const confirmBulkDelete = async () => {
    const items = aeds.filter((a) => selected.has(a.id)).map((a) => ({ id: a.id, qrToken: a.qrToken }))
    setBusy(true)
    try {
      await bulkDeleteAeds(orgId, items, { uid: profile?.uid, name: profile?.name })
      toast.success(`${items.length} AED(s) deleted`)
      setSelected(new Set()); setBulkRemoving(false)
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const save = async (e) => {
    e.preventDefault()
    // Details can be filled in later — records save even when incomplete
    // (they're flagged as "data not available" on the dashboard/repository).
    setBusy(true)
    try {
      const actor = { uid: profile?.uid, name: profile?.name }
      if (editing.id) { await updateAed(orgId, orgName, editing.id, editing, actor); toast.success('AED updated') }
      else { await addAed(orgId, orgName, editing, actor); toast.success('AED added') }
      setEditing(null)
    } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  const confirmDelete = async () => {
    try {
      await deleteAed(orgId, removing.id, removing.qrToken, { uid: profile?.uid, name: profile?.name }, `${removing.assetId || 'AED'} @ ${removing.centerName}`)
      toast.success('AED deleted')
    } catch (err) { toast.error(err.message) } finally { setRemoving(null) }
  }
  // View the QR — or, for admins, mint one first if the record lacks it.
  const showQr = async (a) => {
    if (a.qrToken) { setQrFor(a); return }
    if (!isAdmin) { toast.error('Only an admin can generate QR codes'); return }
    setBusy(true)
    try {
      const token = await generateAedQr(orgId, orgName, a, { uid: profile?.uid, name: profile?.name })
      setQrFor({ ...a, qrToken: token })
      toast.success('QR code generated')
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  const openService = (a) => { setServiceFor(a); setNextDate(a.nextInspection || '') }
  const confirmService = async () => {
    setBusy(true)
    try {
      await serviceAed(orgId, orgName, serviceFor, nextDate, { uid: profile?.uid, name: profile?.name })
      toast.success('Inspection logged')
      setServiceFor(null)
    } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  const doExport = () => {
    if (!visible.length) return toast.error('Nothing to export')
    exportRows(visible.map((a) => ({
      'Asset ID': a.assetId, Brand: a.brand, Model: a.model, Site: a.centerName, Region: a.region,
      Entity: a.entity, Location: a.location, Status: AED_STATUS_LABEL[a.status] || a.status,
      'Install Date': a.installDate, 'Battery Expiry': a.batteryExpiry, 'Pad Expiry': a.padExpiry,
      'Last Inspection': a.lastInspection, 'Next Inspection': a.nextInspection, Notes: a.notes,
    })), 'AED', 'fire-marshal-aed.xlsx')
    toast.success('Exported to Excel')
  }
  const set = (k) => (e) => setEditing({ ...editing, [k]: e.target.value })

  return (
    <div>
      <PageHeader title="AED Repository" subtitle={`${visible.length}${anyActive ? ` of ${aeds.length}` : ''} defibrillator${visible.length === 1 ? '' : 's'}`} icon={HeartPulse}>
        {isAdmin && missingSites.length > 0 && (
          <button className="btn-soft" onClick={generateAll} disabled={busy} title="Create an AED with a QR code for every 1P/2P site that doesn't have one">
            <QrCode size={16} /> Generate for 1P/2P sites ({missingSites.length})
          </button>
        )}
        {isAdmin && <Link to="/equipment/asset-bulk-upload" state={{ kind: 'aed' }} className="btn-soft"><Upload size={16} /> Bulk upload</Link>}
        <button className="btn-soft" onClick={doExport} disabled={!aeds.length}><Download size={16} /> Export</button>
        <button className="btn-primary" onClick={openAdd}><Plus size={16} /> Add AED</button>
      </PageHeader>

      {!loading && aeds.length > 0 && (
        <div className="card mb-4 space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-ink-400"><Filter size={13} /> Filters</span>
            <div className="relative min-w-[200px] flex-1">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input className="input pl-9" placeholder="Search asset ID, brand, site…" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
            </div>
            {anyActive ? <button className="btn-ghost" onClick={clear}><X size={15} /> Clear</button> : null}
          </div>
          <ChipRow label="Region" options={REGIONS} selected={f.regions} onToggle={(v) => toggle('regions', v)} />
          <ChipRow label="Entity" options={ENTITIES} selected={f.entities} onToggle={(v) => toggle('entities', v)} />
          <ChipRow label="Status" options={STATUSES} selected={f.statuses} onToggle={(v) => toggle('statuses', v)} render={(s) => AED_STATUS_LABEL[s]} />
        </div>
      )}

      {loading ? (
        <div className="grid place-items-center py-20"><Spinner size={28} /></div>
      ) : aeds.length === 0 ? (
        <EmptyState icon={HeartPulse} title="No AEDs yet" hint="Add your first defibrillator to start tracking battery, pad and inspection due dates."
          action={<button className="btn-primary" onClick={openAdd}><Plus size={16} /> Add AED</button>} />
      ) : visible.length === 0 ? (
        <EmptyState icon={Filter} title="No matches" hint="Try adjusting the filters." action={<button className="btn-ghost" onClick={clear}><X size={15} /> Clear filters</button>} />
      ) : (
        <>
          {selected.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand-50 px-4 py-2.5 text-sm">
              <span className="font-semibold text-brand-700">{selected.size} selected</span>
              <div className="flex gap-2">
                <button className="btn-ghost px-3 py-1.5" onClick={() => setSelected(new Set())}>Clear</button>
                <button className="btn-danger px-3 py-1.5" onClick={() => setBulkRemoving(true)}><Trash2 size={15} /> Delete selected</button>
              </div>
            </div>
          )}
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-clay-100/70 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3"><input type="checkbox" className="h-4 w-4 cursor-pointer accent-brand-500" checked={allOnPage} onChange={toggleAllOnPage} title="Select all on this page" /></th>
                  <th className="px-4 py-3">Asset ID</th><th className="px-4 py-3">Site</th><th className="px-4 py-3">Region</th>
                  <th className="px-4 py-3">Battery Exp</th><th className="px-4 py-3">Pad Exp</th><th className="px-4 py-3">Next Inspection</th>
                  <th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-clay-200/60">
                {pageItems.map((a) => (
                  <tr key={a.id} className={`hover:bg-ink-50/70 ${selected.has(a.id) ? 'bg-brand-50/60' : ''}`} style={{ boxShadow: `inset 4px 0 0 ${aedColor(a, today)}` }}>
                    <td className="px-4 py-3"><input type="checkbox" className="h-4 w-4 cursor-pointer accent-brand-500" checked={selected.has(a.id)} onChange={() => toggleSel(a.id)} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 font-bold text-ink-900">
                        {a.assetId || '—'}
                        {aedIncomplete(a) && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700" title="Data not available — battery/pad expiry or site still need entering">
                            <AlertTriangle size={11} /> Data N/A
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-ink-500">{[a.brand, a.model].filter(Boolean).join(' ') || '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-ink-700">{a.centerName}{a.location ? <span className="block text-xs text-ink-400">{a.location}</span> : null}</td>
                    <td className="px-4 py-3 text-ink-600">{a.region || '—'}</td>
                    <td className="px-4 py-3"><DateCell value={a.batteryExpiry} /></td>
                    <td className="px-4 py-3"><DateCell value={a.padExpiry} /></td>
                    <td className="px-4 py-3"><DateCell value={a.nextInspection} /></td>
                    <td className="px-4 py-3"><Badge color={AED_STATUS_COLOR[a.status] || '#64748b'}>{AED_STATUS_LABEL[a.status] || a.status}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button className="btn bg-green-600 px-2 py-1.5 text-xs text-white hover:bg-green-700" onClick={() => openService(a)} title="Log inspection / service"><Wrench size={14} /></button>
                        <button className="btn-soft px-2 py-1.5" onClick={() => showQr(a)} disabled={busy || (!a.qrToken && !isAdmin)} title={a.qrToken ? 'View QR code' : (isAdmin ? 'Generate QR code' : 'Only an admin can generate QR codes')}><QrCode size={15} /></button>
                        <button className="btn-soft px-2 py-1.5" onClick={() => setEditing(a)} title="Edit"><Pencil size={15} /></button>
                        <button className="btn-soft px-2 py-1.5 text-red-600" onClick={() => setRemoving(a)} title="Delete"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-ink-500">Showing <strong>{(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, visible.length)}</strong> of <strong>{visible.length}</strong></span>
            {pageCount > 1 && (
              <div className="flex items-center gap-1.5">
                <button className="btn-ghost px-3 py-1.5" onClick={() => setPage(safePage - 1)} disabled={safePage === 1}>Prev</button>
                <span className="px-2 font-semibold text-ink-700">Page {safePage} / {pageCount}</span>
                <button className="btn-ghost px-3 py-1.5" onClick={() => setPage(safePage + 1)} disabled={safePage === pageCount}>Next</button>
              </div>
            )}
          </div>
        </>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit AED' : 'Add AED'}>
        {editing && (
          <form onSubmit={save} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Asset ID (auto)"><input className="input bg-ink-50 text-ink-500" value={editing.assetId} readOnly title="Automatically assigned — unique per AED" /></Field>
              <div className="sm:col-span-2">
                <label className="label">Site — Region · Entity · Site</label>
                <SiteScopePicker
                  module="equipment"
                  sites={siteInventory}
                  value={{ ...editing, site: editing.centerName }}
                  onChange={(v) => setEditing((p) => ({ ...p, ...v, centerName: v.site }))}
                />
              </div>
              <Field label="Brand"><input className="input" value={editing.brand} onChange={set('brand')} placeholder="e.g. Philips" /></Field>
              <Field label="Model"><input className="input" value={editing.model} onChange={set('model')} placeholder="e.g. HeartStart FRx" /></Field>
              <Field label="Location / placement"><input className="input" value={editing.location} onChange={set('location')} placeholder="e.g. Reception wall cabinet" /></Field>
              <Field label="Status"><select className="input" value={editing.status} onChange={set('status')}>{STATUSES.map((s) => <option key={s} value={s}>{AED_STATUS_LABEL[s]}</option>)}</select></Field>
              <Field label="Install date"><input type="date" className="input" value={editing.installDate} onChange={set('installDate')} /></Field>
              <Field label="Battery expiry"><input type="date" className="input" value={editing.batteryExpiry} onChange={set('batteryExpiry')} /></Field>
              <Field label="Pad expiry"><input type="date" className="input" value={editing.padExpiry} onChange={set('padExpiry')} /></Field>
              <Field label="Last inspection"><input type="date" className="input" value={editing.lastInspection} onChange={set('lastInspection')} /></Field>
              <Field label="Next inspection"><input type="date" className="input" value={editing.nextInspection} onChange={set('nextInspection')} /></Field>
            </div>
            <Field label="Notes"><textarea className="input" rows={2} value={editing.notes} onChange={set('notes')} /></Field>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? <Spinner size={16} /> : (editing.id ? 'Save changes' : 'Add AED')}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!removing} onClose={() => setRemoving(null)} title="Delete AED?">
        <p className="text-sm text-ink-600">Remove <span className="font-semibold">{removing?.assetId || 'this AED'}</span> at <span className="font-semibold">{removing?.centerName}</span>? This can’t be undone.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setRemoving(null)}>Cancel</button>
          <button className="btn-danger" onClick={confirmDelete}>Delete</button>
        </div>
      </Modal>

      <Modal open={bulkRemoving} onClose={() => setBulkRemoving(false)} title={`Delete ${selected.size} AED(s)?`}>
        <p className="text-sm text-ink-600">Permanently remove <span className="font-semibold">{selected.size}</span> selected AED{selected.size === 1 ? '' : 's'} and their QR codes? This can’t be undone.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setBulkRemoving(false)}>Cancel</button>
          <button className="btn-danger" onClick={confirmBulkDelete} disabled={busy}>{busy ? <Spinner size={16} /> : `Delete ${selected.size}`}</button>
        </div>
      </Modal>

      <Modal open={!!qrFor} onClose={() => setQrFor(null)} title={`QR — ${qrFor?.assetId || 'AED'}`}>
        {qrFor && (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="rounded-2xl bg-white p-4 shadow-clay"><QRCodeSVG value={publicQrUrl(qrFor.qrToken)} size={200} level="H" includeMargin /></div>
            <p className="text-sm font-bold text-ink-900">{qrFor.assetId || 'AED'} · {qrFor.centerName}</p>
            <p className="break-all text-xs text-ink-400">{publicQrUrl(qrFor.qrToken)}</p>
            <p className="text-xs text-ink-500">Scanning opens a public status page where anyone can report a defect.</p>
          </div>
        )}
      </Modal>

      <Modal open={!!serviceFor} onClose={() => setServiceFor(null)} title="Log inspection / service">
        {serviceFor && (
          <div className="space-y-4">
            <p className="text-sm text-ink-600">Record an inspection for <strong>{serviceFor.assetId || 'this AED'}</strong> @ <strong>{serviceFor.centerName}</strong>. Last inspection is set to today and status to <strong>Ready</strong>.</p>
            <Field label="Next inspection due"><input type="date" className="input" value={nextDate} onChange={(e) => setNextDate(e.target.value)} /></Field>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setServiceFor(null)}>Cancel</button>
              <button className="btn-primary" onClick={confirmService} disabled={busy}>{busy ? <Spinner size={16} /> : 'Log inspection'}</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
