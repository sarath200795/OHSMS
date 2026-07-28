import { useMemo, useState } from 'react'
import { CalendarPlus, Repeat, Clock, Trash2, Check, Globe } from 'lucide-react'
import { Modal, StatusPill } from '../../components/ui'
import { useData } from '../../context/DataContext'
import { ASSIGNMENT_FREQUENCIES, formatDateOnly } from '../../lib/schedule'

/**
 * Manage one-off / recurring assignments for an inspection form. Each
 * assignment targets a specific site (+ optional area, frequency, end date) and
 * can be rescheduled, cancelled, reopened or removed.
 *
 * Props:
 *   template         — the form being assigned (carries .assignments)
 *   currentUserEmail — stamps history entries
 *   onClose          — close the modal
 *   onSave           — async (nextAssignments) => Promise<void>
 */
export default function InspectionAssignmentsModal({ template, currentUserEmail, onClose, onSave }) {
  const todayIso = formatDateOnly(new Date())
  const { sites } = useData()

  const [newSiteIds, setNewSiteIds] = useState(template.siteId ? [template.siteId] : [])
  const [siteSearch, setSiteSearch] = useState('')
  const [newArea, setNewArea] = useState('')
  const [newDate, setNewDate] = useState('')
  const [newEndDate, setNewEndDate] = useState('')
  const [newFrequency, setNewFrequency] = useState('One-off')
  const [newNotes, setNewNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const [rescheduleId, setRescheduleId] = useState(null)
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [rescheduleReason, setRescheduleReason] = useState('')

  const existing = useMemo(
    () => (Array.isArray(template.assignments) ? template.assignments : []),
    [template.assignments]
  )

  const persist = async (next) => {
    setBusy(true)
    try {
      await onSave(next)
    } finally {
      setBusy(false)
    }
  }

  // Toggle one site in/out of the selection.
  const toggleSite = (id) =>
    setNewSiteIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  const allSelected = sites.length > 0 && newSiteIds.length === sites.length
  const toggleAll = () => setNewSiteIds(allSelected ? [] : sites.map((s) => s.id))

  // Filter the site chips by name / code / region / entity so a long list stays
  // manageable, and let the user add every match at once.
  const filteredSites = useMemo(() => {
    const q = siteSearch.trim().toLowerCase()
    if (!q) return sites
    return sites.filter((s) =>
      `${s.name || ''} ${s.code || ''} ${s.region || ''} ${s.entity || ''}`.toLowerCase().includes(q)
    )
  }, [sites, siteSearch])
  const selectAllShown = () =>
    setNewSiteIds((cur) => [...new Set([...cur, ...filteredSites.map((s) => s.id)])])

  const handleAdd = async () => {
    if (sites.length && newSiteIds.length === 0) return alert('Please pick at least one site (or “All sites”).')
    if (!newDate) return alert('Please pick a start date.')
    if (newEndDate && newEndDate < newDate) return alert('End date is before start date.')

    const now = Date.now()
    const base = {
      area: newArea.trim(),
      scheduledDate: newDate,
      frequency: newFrequency === 'One-off' ? '' : newFrequency,
      endDate: newEndDate || '',
      status: 'Pending',
      notes: newNotes.trim(),
      createdAt: new Date().toISOString(),
      createdBy: currentUserEmail || '',
      history: [],
    }
    // One concrete assignment per selected site (or a single site-less one when
    // no sites exist yet) — keeps scheduling/filtering per-site as before.
    const targets = sites.length ? newSiteIds : ['']
    const additions = targets.map((siteId, i) => ({
      id: `asn-${now}-${i}-${Math.floor(Math.random() * 10000)}`,
      siteId,
      siteName: sites.find((s) => s.id === siteId)?.name || '',
      ...base,
    }))

    await persist([...existing, ...additions])
    setNewSiteIds([])
    setNewArea('')
    setNewDate('')
    setNewEndDate('')
    setNewFrequency('One-off')
    setNewNotes('')
  }

  const handleReschedule = async (assignment) => {
    if (!rescheduleDate) return alert('Please pick a new date.')
    const next = existing.map((a) => {
      if (a.id !== assignment.id) return a
      return {
        ...a,
        scheduledDate: rescheduleDate,
        status: 'Pending',
        history: [
          ...(Array.isArray(a.history) ? a.history : []),
          {
            prevDate: a.scheduledDate,
            newDate: rescheduleDate,
            at: new Date().toISOString(),
            by: currentUserEmail || '',
            reason: rescheduleReason.trim(),
          },
        ],
      }
    })
    await persist(next)
    setRescheduleId(null)
    setRescheduleDate('')
    setRescheduleReason('')
  }

  const handleCancel = async (assignment) => {
    if (!window.confirm(`Cancel this assignment for ${assignment.scheduledDate}?`)) return
    await persist(existing.map((a) => (a.id === assignment.id ? { ...a, status: 'Cancelled' } : a)))
  }

  const handleReopen = async (assignment) => {
    await persist(existing.map((a) => (a.id === assignment.id ? { ...a, status: 'Pending' } : a)))
  }

  const handleDelete = async (assignment) => {
    if (!window.confirm('Remove this assignment entirely?')) return
    await persist(existing.filter((a) => a.id !== assignment.id))
  }

  return (
    <Modal open onClose={onClose} title={`Assignments · ${template.title}`} maxWidth="max-w-3xl">
      {/* Add new */}
      <div className="rounded-2xl bg-clay-surface p-4 shadow-clay-inset">
        <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-ink-500">Schedule a new inspection</p>
        {sites.length === 0 && (
          <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
            No sites yet — an admin can add sites under <strong>Sites</strong> so you can target one. You can still schedule without a site for now.
          </div>
        )}
        {/* Site picker: pick one, several, or all sites at once */}
        {sites.length > 0 && (
          <div className="mb-3">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <label className="label !mb-0">Sites *</label>
              {sites.length > 6 && (
                <input
                  className="input !w-56 !py-1.5 !text-xs"
                  placeholder="Search name, region, entity…"
                  value={siteSearch}
                  onChange={(e) => setSiteSearch(e.target.value)}
                />
              )}
            </div>
            {/* bulk-selection controls */}
            <div className="mb-1.5 flex flex-wrap gap-2">
              <button type="button" onClick={toggleAll}
                className={`chip transition ${allSelected ? 'bg-brand-600 text-white shadow-clay-brand' : 'bg-clay-surface text-ink-600 shadow-clay-sm'}`}>
                {allSelected ? <Check size={12} /> : <Globe size={12} />} All sites ({sites.length})
              </button>
              {siteSearch.trim() && filteredSites.length > 0 && (
                <button type="button" onClick={selectAllShown}
                  className="chip bg-brand-50 text-brand-700 shadow-clay-sm transition hover:bg-brand-100">
                  <Check size={12} /> Select all shown ({filteredSites.length})
                </button>
              )}
              {newSiteIds.length > 0 && (
                <button type="button" onClick={() => setNewSiteIds([])}
                  className="chip bg-clay-surface text-ink-500 shadow-clay-sm transition hover:bg-clay-100">
                  Clear selection
                </button>
              )}
            </div>
            {/* recessed clay tray holding raised clay chips (scrolls for long lists) */}
            <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto custom-scroll rounded-2xl bg-clay-surface p-2.5 shadow-clay-inset">
              {filteredSites.map((s) => {
                const sel = newSiteIds.includes(s.id)
                return (
                  <button key={s.id} type="button" onClick={() => toggleSite(s.id)}
                    className={`chip transition ${sel ? 'bg-brand-500 text-white shadow-clay-brand' : 'bg-clay-surface text-ink-600 shadow-clay-sm'}`}>
                    {sel && <Check size={12} />}{s.name}{s.code ? ` (${s.code})` : ''}
                  </button>
                )
              })}
              {filteredSites.length === 0 && (
                <span className="px-1 py-0.5 text-xs italic text-ink-400">No sites match “{siteSearch}”.</span>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-ink-400">
              {newSiteIds.length === 0
                ? 'Pick one or more sites, or “All sites”.'
                : `${newSiteIds.length} site${newSiteIds.length === 1 ? '' : 's'} selected — one assignment will be created per site.`}
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Area / sub-location (optional)</label>
            <input className="input" value={newArea} placeholder="e.g. Warehouse B"
              onChange={(e) => setNewArea(e.target.value)} />
          </div>
          <div>
            <label className="label">Frequency</label>
            <select className="input" value={newFrequency} onChange={(e) => setNewFrequency(e.target.value)}>
              {ASSIGNMENT_FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{newFrequency === 'One-off' ? 'Scheduled date' : 'Start date'} *</label>
            <input type="date" className="input font-mono" value={newDate} min={todayIso}
              onChange={(e) => setNewDate(e.target.value)} />
          </div>
          {newFrequency !== 'One-off' && (
            <div>
              <label className="label">End date (optional)</label>
              <input type="date" className="input font-mono" value={newEndDate} min={newDate || todayIso}
                onChange={(e) => setNewEndDate(e.target.value)} />
            </div>
          )}
          <div className="sm:col-span-2">
            <label className="label">Notes (optional)</label>
            <input className="input" value={newNotes} placeholder="e.g. End-of-quarter compliance check"
              onChange={(e) => setNewNotes(e.target.value)} />
          </div>
        </div>
        <button className="btn-primary mt-3" disabled={busy || !newDate || (sites.length > 0 && newSiteIds.length === 0)} onClick={handleAdd}>
          <CalendarPlus size={16} /> {sites.length > 0 && newSiteIds.length > 1 ? `Add ${newSiteIds.length} assignments` : 'Add assignment'}
        </button>
      </div>

      {/* Existing */}
      <p className="mb-2 mt-5 text-[10px] font-bold uppercase tracking-widest text-ink-500">
        Existing assignments ({existing.length})
      </p>
      {existing.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-clay-300 p-6 text-center text-sm italic text-ink-400">
          No assignments yet. Schedule one above.
        </div>
      ) : (
        <div className="space-y-3">
          {existing.map((a) => {
            const isOverdue = a.status === 'Pending' && a.scheduledDate < todayIso
            const isResch = rescheduleId === a.id
            return (
              <div key={a.id} className="rounded-2xl bg-clay-surface p-4 shadow-clay-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <StatusPill status={a.status} />
                      {isOverdue && <StatusPill status="FAIL" />}
                    </div>
                    <div className="text-sm text-ink-800">
                      <strong className="font-mono text-brand-700">{a.scheduledDate}</strong>
                      {a.frequency && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded bg-brand-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-brand-700">
                          <Repeat size={11} /> {a.frequency}
                          {a.endDate && <span className="font-normal text-ink-400">until {a.endDate}</span>}
                        </span>
                      )}
                      {(a.siteName || a.location) && <span className="ml-2 text-ink-500">· {a.siteName || a.location}</span>}
                      {a.area && <span className="ml-1 text-ink-400">({a.area})</span>}
                    </div>
                    {a.notes && <p className="mt-1.5 text-xs italic text-ink-500">“{a.notes}”</p>}
                    {Array.isArray(a.history) && a.history.length > 0 && (
                      <details className="mt-2 text-[11px] text-ink-400">
                        <summary className="cursor-pointer hover:text-ink-700">Reschedule history ({a.history.length})</summary>
                        <ul className="mt-1.5 ml-4 list-disc space-y-1">
                          {a.history.map((h, i) => (
                            <li key={i}>
                              <span className="font-mono">{h.prevDate}</span> → <span className="font-mono text-brand-700">{h.newDate}</span>
                              {h.reason && <span className="ml-1">({h.reason})</span>}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {a.status === 'Pending' && !isResch && (
                      <button
                        onClick={() => { setRescheduleId(a.id); setRescheduleDate(a.scheduledDate); setRescheduleReason('') }}
                        className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-brand-700 transition hover:bg-brand-100"
                      >
                        <Clock size={11} className="mr-1 inline" /> Reschedule
                      </button>
                    )}
                    {a.status === 'Pending' && (
                      <button onClick={() => handleCancel(a)} disabled={busy}
                        className="rounded-lg border border-clay-300 bg-clay-surface px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-500 transition hover:bg-clay-100">
                        Cancel
                      </button>
                    )}
                    {a.status === 'Cancelled' && (
                      <button onClick={() => handleReopen(a)} disabled={busy}
                        className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-amber-700 transition hover:bg-amber-100">
                        Reopen
                      </button>
                    )}
                    <button onClick={() => handleDelete(a)} disabled={busy}
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-red-600 transition hover:bg-red-100">
                      <Trash2 size={11} className="mr-1 inline" /> Remove
                    </button>
                  </div>
                </div>

                {isResch && (
                  <div className="mt-3 grid grid-cols-1 gap-2 rounded-xl bg-clay-bg p-3 sm:grid-cols-[160px,1fr,auto]">
                    <input type="date" className="input font-mono" value={rescheduleDate}
                      onChange={(e) => setRescheduleDate(e.target.value)} />
                    <input className="input" placeholder="Reason (optional)" value={rescheduleReason}
                      onChange={(e) => setRescheduleReason(e.target.value)} />
                    <div className="flex gap-2">
                      <button className="btn-primary" disabled={busy || !rescheduleDate} onClick={() => handleReschedule(a)}>Save</button>
                      <button className="btn-ghost" onClick={() => setRescheduleId(null)}>Discard</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
