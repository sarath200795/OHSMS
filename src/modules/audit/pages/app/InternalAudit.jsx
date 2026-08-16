import React, { useState, useEffect, useMemo } from 'react'
import {
  AlertCircle, AlertTriangle, ArrowLeft, Calendar, CalendarDays, Check, CheckCheck, CheckCircle2,
  ChevronLeft, ChevronRight, ClipboardCheck, ClipboardList, Download, FileDown, FileSignature,
  FileText, Hourglass, Inbox, Info, Layers, List, ListChecks, Pencil, PieChart, Play, Plus, Printer,
  Reply, RotateCcw, Save, Search, Send, Target, Trash2, User, UserPen, UserRound, X,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useOrgData } from '../../context/OrgDataContext'
import SiteScopePicker from '../../../../shared/org/SiteScopePicker'
import DepartmentSelect from '../../../../shared/org/DepartmentSelect'
import { safeHref } from '../../../../shared/safeUrl'
import {
  subscribeAuditPlans,
  subscribeAuditFindings,
  createAuditPlan,
  createAuditFinding,
  updateAuditFinding,
} from '../../services/auditModule'

/*
 * Internal Audit module — adapted from the original OHSMS portal's Audit.jsx
 * into this clone's light theme and Firebase setup. Six sub-modules behind a
 * hub: Scheduler, Auditor Workplace, Auditee Workplace, Reports, Dashboard,
 * Calendar. Data lives in organizations/{orgId}/auditPlans + auditFindings.
 */

// ---- shared helpers ---------------------------------------------------------
/** Resolve a site id or code to its name; falls back to the raw value. */
const siteNameOf = (sites = [], id) => sites.find((s) => s.id === id || s.code === id)?.name || id

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => resolve(reader.result)
    reader.onerror = (e) => reject(e)
  })

const getTypeClass = (type) => {
  const t = type || ''
  if (t.includes('Major')) return 'bg-rose-50 text-rose-600 border border-rose-300'
  if (t.includes('Minor')) return 'bg-orange-50 text-orange-600 border border-orange-300'
  if (t.includes('OFI')) return 'bg-amber-50 text-amber-700 border border-amber-300'
  return 'bg-sky-50 text-sky-600 border border-sky-300'
}

const fld =
  'w-full bg-white border border-slate-300 rounded-lg p-2.5 text-sm text-ink-800 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-400/20'
const lbl =
  'text-[10px] uppercase font-bold text-slate-500 tracking-widest block mb-1.5'
const panel = 'bg-white border border-slate-200 rounded-2xl shadow-sm'

// ============================================================================
// MODULE 1: AUDIT SCHEDULER
// ============================================================================
const AuditScheduler = ({ setView, session, sites, users, locations = [], siteInventory = [] }) => {
  const [teamSearch, setTeamSearch] = useState('')
  const [plan, setPlan] = useState({
    siteId: '',
    region: '',
    entity: '',
    centerCode: '',
    leadAuditor: '',
    team: [],
    standard: 'ISO 45001:2018',
    startDate: '',
    endDate: '',
    docId: '',
  })
  const [rows, setRows] = useState([
    { auditor: '', auditee: '', dept: '', area: '', aspect: '', date: '', time: '' },
  ])
  const myName = session.name

  useEffect(() => {
    if (plan.siteId) {
      const seq = 1000 + Math.floor(rows.length * 137 + plan.siteId.length * 41) % 9000
      setPlan((p) => ({ ...p, docId: `${session.orgId.slice(0, 5)}-${plan.siteId.slice(0, 5)}-IAP-${seq}` }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.siteId])

  const addRow = () =>
    setRows([...rows, { auditor: '', auditee: '', dept: '', area: '', aspect: '', date: '', time: '' }])
  const removeRow = (i) => setRows(rows.filter((_, idx) => idx !== i))
  const updateRow = (i, f, v) => {
    const next = [...rows]
    next[i][f] = v
    setRows(next)
  }
  const toggleTeam = (name) =>
    setPlan((p) => ({
      ...p,
      team: p.team.includes(name) ? p.team.filter((t) => t !== name) : [...p.team, name],
    }))

  const handleSave = async () => {
    if (!plan.siteId || !plan.startDate || !plan.leadAuditor)
      return alert('Please fill in Site, Lead Auditor and Start Date.')
    try {
      await createAuditPlan(session.orgId, {
        ...plan,
        matrix: rows,
        createdAt: new Date().toISOString(),
        createdBy: session.user,
        status: 'Planned',
      })
      alert('Audit Plan saved successfully!')
      setView('hub')
    } catch (e) {
      alert('Save failed: ' + e.message)
    }
  }

  // The scope picker stores the site's id; older data may hold its code. Match
  // either, and fall back to the stored value so nothing renders blank.
  const siteName = (id) => siteNameOf(sites, id)
  const filteredAuditors = useMemo(() => {
    if (!teamSearch) return users
    const q = teamSearch.toLowerCase()
    return users.filter(
      (u) => u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q),
    )
  }, [users, teamSearch])

  return (
    <div className="animate-fade-in">
      <style>{`@media print { @page { size: A4 landscape; margin: 10mm; } }`}</style>
      <div className="mb-6 flex items-center justify-between print:hidden">
        <div>
          <h2 className="text-2xl font-extrabold text-ink-800">
            <Calendar size={20} className="inline mr-2 text-brand-500" /> Audit Scheduler
          </h2>
          <p className="text-sm text-slate-500">Plan and assign audits across the organization.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="rounded-xl bg-slate-100 px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-200">
            <Printer size={16} className="inline mr-2" />Print Plan
          </button>
          <button onClick={handleSave} className="rounded-xl bg-brand-gradient px-5 py-2.5 text-sm font-bold text-white shadow-brand transition active:scale-95">
            <Save size={16} className="inline mr-2" />Save Plan
          </button>
        </div>
      </div>

      <div className="space-y-6 pb-10 print:hidden">
        {/* Section 1 */}
        <div className={`${panel} border-l-4 border-l-brand-500 p-7`}>
          <h3 className="mb-6 text-lg font-bold text-brand-600">Section 1: General Information</h3>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            <div className="space-y-4">
              <div>
                <label className={lbl}>Target Site (Region · Entity · Site)</label>
                <SiteScopePicker
                  module="audit"
                  cols={1}
                  sites={siteInventory}
                  value={plan}
                  onChange={(v) => setPlan({ ...plan, ...v })}
                />
              </div>
              <div>
                <label className={lbl}>Center / Point</label>
                <input value={plan.centerCode} onChange={(e) => setPlan({ ...plan, centerCode: e.target.value })} className={fld} maxLength={500} placeholder="Optional" />
              </div>
              <div>
                <label className={lbl}>Standard</label>
                <input value={plan.standard} onChange={(e) => setPlan({ ...plan, standard: e.target.value })} className={fld} maxLength={500} />
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className={lbl}>Lead Auditor</label>
                <select value={plan.leadAuditor} onChange={(e) => setPlan({ ...plan, leadAuditor: e.target.value })} className={fld}>
                  <option value="">Select...</option>
                  <option value={myName}>➡️ Assign to Me ({myName})</option>
                  {users.map((u) => <option key={u.id} value={u.name}>{u.name}{u.email ? ` (${u.email})` : ''}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className={lbl}>Start Date</label><input type="date" value={plan.startDate} onChange={(e) => setPlan({ ...plan, startDate: e.target.value })} className={`${fld} font-mono`} /></div>
                <div><label className={lbl}>End Date</label><input type="date" value={plan.endDate} onChange={(e) => setPlan({ ...plan, endDate: e.target.value })} className={`${fld} font-mono`} /></div>
              </div>
              {plan.docId && <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Ref ID: <span className="font-mono font-bold text-slate-700">{plan.docId}</span></div>}
            </div>
            <div className="flex flex-col rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <label className={lbl}>Audit Team Members</label>
              <div className="relative mb-3">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" placeholder="Search name or email..." value={teamSearch} onChange={(e) => setTeamSearch(e.target.value)} className={`${fld} pl-9`} maxLength={500} />
              </div>
              <div className="max-h-[160px] flex-1 space-y-1.5 overflow-y-auto">
                {filteredAuditors.map((u) => (
                  <div key={u.id} onClick={() => toggleTeam(u.name)} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 transition ${plan.team.includes(u.name) ? 'border-brand-300 bg-brand-50' : 'border-transparent hover:bg-white'}`}>
                    <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${plan.team.includes(u.name) ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300 bg-white'}`}>
                      {plan.team.includes(u.name) && <Check size={10} className="inline" />}
                    </div>
                    <div className="truncate">
                      <div className={`truncate text-xs font-bold ${plan.team.includes(u.name) ? 'text-brand-700' : 'text-slate-700'}`}>{u.name}</div>
                      <div className="truncate text-[9px] text-slate-400">{u.email || 'No email'}</div>
                    </div>
                  </div>
                ))}
                {filteredAuditors.length === 0 && <div className="py-4 text-center text-xs italic text-slate-400">No auditors found.</div>}
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: matrix */}
        <div className={`${panel} border-t-4 border-t-emerald-500 p-7`}>
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-lg font-bold text-emerald-600">Section 2: Audit Execution Matrix</h3>
            <button onClick={addRow} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-100">
              <Plus size={16} className="inline mr-2 text-emerald-500" />Add Row
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="p-3">Auditor</th><th className="p-3">Auditee</th><th className="p-3">Department</th>
                  <th className="p-3">Area</th><th className="p-3">Aspect / Process</th><th className="p-3 w-36">Date</th>
                  <th className="p-3 w-28">Time</th><th className="p-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50/60">
                    <td className="p-2">
                      <select className={`${fld} text-xs`} value={row.auditor} onChange={(e) => updateRow(i, 'auditor', e.target.value)}>
                        <option value="">Select...</option>
                        <option value={myName}>➡️ Assign to Me</option>
                        {plan.leadAuditor && <option value={plan.leadAuditor}>{plan.leadAuditor} (Lead)</option>}
                        {plan.team.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </td>
                    <td className="p-2">
                      <select className={`${fld} text-xs`} value={row.auditee} onChange={(e) => updateRow(i, 'auditee', e.target.value)}>
                        <option value="">Select...</option>
                        <option value={myName}>➡️ Assign to Me</option>
                        {users.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
                      </select>
                    </td>
                    <td className="p-2"><DepartmentSelect className={`${fld} text-xs`} value={row.dept} onChange={(e) => updateRow(i, 'dept', e.target.value)} placeholder="Dept…" /></td>
                    <td className="p-2">
                      <input className={`${fld} text-xs`} list="audit-locations" placeholder="Area" value={row.area} onChange={(e) => updateRow(i, 'area', e.target.value)} maxLength={500} />
                      {i === 0 && <datalist id="audit-locations">{locations.map((l) => <option key={l} value={l} />)}</datalist>}
                    </td>
                    <td className="p-2"><input className={`${fld} text-xs`} placeholder="Scope / clause..." value={row.aspect} onChange={(e) => updateRow(i, 'aspect', e.target.value)} maxLength={500} /></td>
                    <td className="p-2"><input type="date" className={`${fld} text-xs font-mono`} value={row.date} onChange={(e) => updateRow(i, 'date', e.target.value)} /></td>
                    <td className="p-2"><input type="time" className={`${fld} text-xs font-mono`} value={row.time} onChange={(e) => updateRow(i, 'time', e.target.value)} /></td>
                    <td className="p-2 text-center"><button onClick={() => removeRow(i)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-500 transition hover:bg-rose-500 hover:text-white"><Trash2 size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Print plan */}
      <PrintPlan plan={plan} rows={rows} siteName={siteName(plan.siteId)} />
    </div>
  )
}

// ============================================================================
// MODULE 2: AUDITOR WORKPLACE
// ============================================================================
const AuditorWorkplace = ({ setView, session, isGlobalOwner, plans, findings, sites = [] }) => {
  const siteName = (id) => siteNameOf(sites, id)
  const [view, setWView] = useState('list')
  const [filters, setFilters] = useState({ date: '', auditor: '', auditee: '', id: '' })
  const [currentTask, setCurrentTask] = useState(null)
  const [findingRows, setFindingRows] = useState([])
  const [docId, setDocId] = useState('')
  const [criteria, setCriteria] = useState('')

  const myTasks = useMemo(() => {
    const findingsList = []
    findings.forEach((v) => {
      if (v.auditor === session.user || isGlobalOwner) {
        findingsList.push({ ...(v.taskDetails || {}), status: v.status, findingRecord: v, _key: `${v.taskDetails?.planId}_${v.taskDetails?.area}_${v.taskDetails?.auditee}` })
      }
    })
    const plannedList = []
    plans.forEach((plan) => {
      (plan.matrix || []).forEach((row) => {
        if (row.auditor === session.user || isGlobalOwner) {
          const key = `${plan.docId}_${row.area}_${row.auditee}`
          if (!findingsList.some((f) => f._key === key)) {
            plannedList.push({ auditor: row.auditor || '', auditee: row.auditee || '', dept: row.dept || '', area: row.area || '', date: row.date || '', time: row.time || '', aspect: row.aspect || '', planId: plan.docId || '', siteId: plan.siteId || '', leadAuditor: plan.leadAuditor || '', standard: plan.standard || '', scope: 'OH&S Management System', status: 'Planned', findingRecord: null, _key: key })
          }
        }
      })
    })
    return [...findingsList, ...plannedList]
  }, [plans, findings, session.user, isGlobalOwner])

  const filtered = useMemo(
    () =>
      myTasks.filter((t) => {
        const md = !filters.date || (t.date && t.date.includes(filters.date))
        const ma = !filters.auditor || t.auditor?.toLowerCase().includes(filters.auditor.toLowerCase())
        const me = !filters.auditee || t.auditee?.toLowerCase().includes(filters.auditee.toLowerCase())
        const mi = !filters.id || t.findingRecord?.docId?.toLowerCase().includes(filters.id.toLowerCase())
        return md && ma && me && mi
      }),
    [myTasks, filters],
  )

  const genId = () => `AF-${10000 + Math.floor((Date.parse(new Date().toISOString()) % 90000))}`

  const openTask = (task) => {
    setCurrentTask(task)
    setCriteria(task.standard || '')
    if (task.status === 'Planned') {
      setDocId(`${session.orgId.slice(0, 5)}-${task.siteId || 'GEN'}-IAF-${10000 + Math.floor(Math.abs(hashStr(task._key)) % 90000)}`)
      setFindingRows([{ id: genId(), type: 'Observation', desc: '', clause: '', evidence: '', fileName: '' }])
      setWView('perform')
    } else {
      setDocId(task.findingRecord.docId)
      setFindingRows(task.findingRecord?.findings || [])
      setCriteria(task.findingRecord?.taskDetails?.criteria || task.standard || '')
      setWView(task.status === 'Submitted for Verification' ? 'verify' : 'readOnly')
    }
  }

  const addRow = () => setFindingRows([...findingRows, { id: genId(), type: 'Observation', desc: '', clause: '', evidence: '', fileName: '' }])
  const removeRow = (i) => setFindingRows(findingRows.filter((_, idx) => idx !== i))
  const updateRow = (i, f, v) => { const u = [...findingRows]; u[i][f] = v; setFindingRows(u) }
  const handleFile = async (i, file) => {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) return alert('File size exceeds 10MB limit.')
    if (!file.type.match('^(image/.*|application/pdf)$')) return alert('Only PDF and image files are allowed.')
    const b64 = await fileToBase64(file)
    const u = [...findingRows]; u[i].evidence = b64; u[i].fileName = file.name; setFindingRows(u)
  }

  const handleSave = async () => {
    if (findingRows.some((f) => !f.desc)) return alert('Please fill the description for every finding.')
    // Objective evidence is mandatory for every finding, regardless of type
    // (Observation, OFI, Minor NC, Major NC).
    if (findingRows.some((f) => !f.evidence)) return alert('Objective evidence is mandatory — attach a file for every finding (Observation, OFI, Minor NC and Major NC).')
    const cleanTask = { ...currentTask, criteria: criteria || '' }
    delete cleanTask.findingRecord
    const cleanFindings = findingRows.map((f, idx) => {
      let days = 30
      if (f.type === 'Minor NC') days = 15
      if (f.type === 'Major NC') days = 7
      const due = new Date(); due.setDate(due.getDate() + days)
      return { ...f, id: f.id || genId() + idx, auditeeDueDate: due.toISOString().split('T')[0] }
    })
    try {
      await createAuditFinding(session.orgId, {
        docId: docId || '', taskDetails: cleanTask, findings: cleanFindings,
        status: 'Reported', auditDate: new Date().toISOString(), auditor: session.user, siteId: cleanTask.siteId || 'GEN',
      })
      alert('Audit saved & sent to auditee.')
      setView('hub')
    } catch (e) { alert('Error saving: ' + e.message) }
  }

  const handleVerifyClose = async () => {
    if (!currentTask.findingRecord) return
    try {
      await updateAuditFinding(session.orgId, currentTask.findingRecord.firebaseKey, { status: 'Closed', closureDate: new Date().toISOString() })
      alert('Audit verified & closed!')
      setView('hub')
    } catch (e) { alert('Error closing: ' + e.message) }
  }

  const rec = currentTask?.findingRecord

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <div>
          <h2 className="text-2xl font-extrabold text-ink-800"><ClipboardList size={20} className="inline mr-2 text-emerald-500" /> Auditor Workplace</h2>
          <p className="text-sm text-slate-500">Execute your assigned audits and raise findings.</p>
        </div>
      </div>

      <div className="print:hidden">
        {view === 'list' && (
          <>
            <div className={`${panel} mb-6 flex flex-wrap items-center gap-3 p-4`}>
              <input type="date" className={`${fld} w-36`} value={filters.date} onChange={(e) => setFilters({ ...filters, date: e.target.value })} />
              <input type="text" placeholder="Auditor" className={`${fld} w-36`} value={filters.auditor} onChange={(e) => setFilters({ ...filters, auditor: e.target.value })} maxLength={500} />
              <input type="text" placeholder="Auditee" className={`${fld} w-36`} value={filters.auditee} onChange={(e) => setFilters({ ...filters, auditee: e.target.value })} maxLength={500} />
              <input type="text" placeholder="Doc ID" className={`${fld} w-28`} value={filters.id} onChange={(e) => setFilters({ ...filters, id: e.target.value })} maxLength={500} />
              <button onClick={() => setFilters({ date: '', auditor: '', auditee: '', id: '' })} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-200"><RotateCcw size={14} className="inline mr-1" />Reset</button>
            </div>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.length === 0 ? (
                <div className="col-span-full rounded-3xl border-2 border-dashed border-slate-200 py-16 text-center text-lg italic text-slate-400">No audits assigned to you yet.</div>
              ) : (
                filtered.map((task, i) => {
                  const map = {
                    Planned: ['border-t-sky-500', 'bg-sky-50 text-sky-700', 'Needs Audit', Play],
                    Reported: ['border-t-rose-500', 'bg-rose-50 text-rose-700', 'Correction Pending', Hourglass],
                    'Submitted for Verification': ['border-t-orange-500', 'bg-orange-50 text-orange-700', 'Verify Now', CheckCheck],
                    Closed: ['border-t-emerald-500', 'bg-emerald-50 text-emerald-700', 'Closed', FileText],
                  }
                  const [brd, chip, label, Icon] = map[task.status] || map.Planned
                  return (
                    <div key={i} onClick={() => openTask(task)} className={`${panel} cursor-pointer border-t-4 ${brd} p-6 transition hover:-translate-y-1 hover:shadow-md`}>
                      <div className="mb-4 flex items-start justify-between">
                        <span className={`rounded px-2 py-1 text-[9px] font-bold uppercase tracking-widest ${chip}`}>{label}</span>
                        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-500"><Calendar size={12} className="inline mr-1" />{task.date || '—'}</span>
                      </div>
                      <h3 className="mb-1 truncate text-lg font-bold text-ink-800">{task.dept} - {task.area}</h3>
                      <p className="mb-5 truncate text-xs text-slate-400"><Target size={14} className="inline mr-1.5" />{task.aspect}</p>
                      <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50 p-3 text-[11px] text-slate-600">
                        <div className="flex justify-between"><span>Site:</span><span className="font-bold text-ink-800">{siteName(task.siteId)}</span></div>
                        <div className="flex justify-between"><span>Auditor:</span><span className="font-bold text-emerald-600">{task.auditor}</span></div>
                        <div className="flex justify-between"><span>Auditee:</span><span className="font-bold text-amber-600">{task.auditee}</span></div>
                      </div>
                      <div className="mt-4 border-t border-slate-100 pt-3 text-center text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        <Icon size={12} className="inline mr-2" />{label}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </>
        )}

        {view === 'perform' && currentTask && (
          <div className="mx-auto max-w-5xl animate-fade-in">
            <div className="mb-6 flex items-center justify-between">
              <button onClick={() => setWView('list')} className="text-sm font-bold text-slate-500 hover:text-slate-800"><ArrowLeft size={16} className="inline mr-2" />Back to Audit List</button>
              <button onClick={handleSave} className="rounded-xl bg-emerald-600 px-8 py-3 text-sm font-bold text-white shadow-lg transition active:scale-95 hover:bg-emerald-500"><Send size={16} className="inline mr-2" />Save & Send to Auditee</button>
            </div>
            <div className={`${panel} mb-8 p-7`}>
              <h3 className="mb-6 border-b border-slate-100 pb-3 text-xs font-bold uppercase tracking-widest text-emerald-600"><Info size={14} className="inline mr-2" />Section 1: Audit Context</h3>
              <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
                {[['Site', siteName(currentTask.siteId)], ['Auditor', currentTask.auditor], ['Auditee', currentTask.auditee], ['Date', currentTask.date]].map(([k, v]) => (
                  <div key={k}><label className={lbl}>{k}</label><div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-sm font-bold text-ink-800">{v || '—'}</div></div>
                ))}
                <div className="col-span-2 md:col-span-4"><label className={lbl}>Standard / Criteria Applied</label><input value={criteria} onChange={(e) => setCriteria(e.target.value)} className={fld} maxLength={500} placeholder="e.g. ISO 45001:2018 Clause 8.1..." /></div>
              </div>
            </div>
            <div className={`${panel} p-7`}>
              <div className="mb-6 flex items-center justify-between border-b border-slate-100 pb-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-brand-600"><ListChecks size={14} className="inline mr-2" />Section 2: Audit Findings Register</h3>
                <button onClick={addRow} className="rounded-xl bg-brand-gradient px-5 py-2 text-xs font-bold text-white shadow-brand transition active:scale-95"><Plus size={14} className="inline mr-2" />Log New Finding</button>
              </div>
              <div className="space-y-6">
                {findingRows.map((f, i) => (
                  <div key={i} className="relative rounded-2xl border border-slate-200 bg-slate-50/60 p-6">
                    <div className="absolute right-4 top-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 font-mono text-[10px] font-bold text-emerald-600">{f.id}</div>
                    <div className="mt-2 grid grid-cols-12 gap-6">
                      <div className="col-span-12 md:col-span-3">
                        <label className={lbl}>Finding Type</label>
                        <select value={f.type} onChange={(e) => updateRow(i, 'type', e.target.value)} className={`w-full rounded-xl p-3 text-xs font-bold ${getTypeClass(f.type)}`}>
                          <option value="Observation">Observation</option>
                          <option value="OFI">Opp. for Improv. (OFI)</option>
                          <option value="Minor NC">Minor Non-Conformance</option>
                          <option value="Major NC">Major Non-Conformance</option>
                        </select>
                      </div>
                      <div className="col-span-12 md:col-span-3"><label className={lbl}>Ref Clause</label><input value={f.clause} onChange={(e) => updateRow(i, 'clause', e.target.value)} className={fld} maxLength={500} placeholder="e.g. 9.1.2" /></div>
                      <div className="col-span-12 md:col-span-6">
                        <label className={lbl}>Objective Evidence <span className="text-rose-500">*</span></label>
                        <input type="file" accept="application/pdf,image/*" onChange={(e) => handleFile(i, e.target.files[0])} className="w-full text-[10px] text-slate-500 file:mr-3 file:rounded-lg file:border-none file:bg-slate-200 file:px-4 file:py-1.5 file:font-bold file:text-slate-600" />
                        {f.fileName ? (
                          <div className="mt-2 truncate text-[10px] font-bold text-emerald-600"><CheckCircle2 size={12} className="inline mr-1" />Attached: {f.fileName}</div>
                        ) : (
                          <div className="mt-2 text-[10px] font-bold text-rose-500"><AlertCircle size={12} className="inline mr-1" />Required — attach objective evidence for this finding.</div>
                        )}
                      </div>
                      <div className="col-span-12"><label className={lbl}>Detailed Description of Finding</label><textarea value={f.desc} onChange={(e) => updateRow(i, 'desc', e.target.value)} rows="3" className={fld} maxLength={2000} placeholder="Describe the specific observation or non-conformance..." /></div>
                    </div>
                    <button onClick={() => removeRow(i)} className="absolute bottom-4 right-4 flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"><Trash2 size={16} /></button>
                  </div>
                ))}
                {findingRows.length === 0 && <div className="rounded-3xl border-2 border-dashed border-slate-200 p-12 text-center italic text-slate-400">No findings logged. The audit is completely clean!</div>}
              </div>
            </div>
          </div>
        )}

        {(view === 'readOnly' || view === 'verify') && rec && (
          <div className="mx-auto max-w-5xl animate-fade-in">
            <div className="mb-6 flex items-center justify-between">
              <button onClick={() => setWView('list')} className="text-sm font-bold text-slate-500 hover:text-slate-800"><ArrowLeft size={16} className="inline mr-2" />Back to Audit List</button>
              <div className="flex gap-3">
                <button onClick={() => window.print()} className="rounded-xl bg-slate-100 px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-200"><Printer size={16} className="inline mr-2" />Print Report</button>
                {view === 'verify' && <button onClick={handleVerifyClose} className="rounded-xl bg-orange-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg transition active:scale-95 hover:bg-orange-500"><CheckCheck size={16} className="inline mr-2" />Verify & Close Audit</button>}
              </div>
            </div>
            <div className={`${panel} p-7`}>
              <div className="mb-8 flex items-start justify-between border-b border-slate-100 pb-6">
                <div>
                  <h2 className="mb-2 text-2xl font-extrabold text-ink-800">Audit Report Details</h2>
                  <p className="inline-block rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 font-mono text-sm font-bold text-emerald-600">Ref: {rec.docId}</p>
                </div>
                <span className={`text-sm font-bold uppercase ${rec.status === 'Closed' ? 'text-emerald-600' : rec.status === 'Submitted for Verification' ? 'text-orange-600' : 'text-rose-600'}`}>{rec.status}</span>
              </div>
              <FindingList findings={rec.findings} />
            </div>
          </div>
        )}
      </div>

      <PrintReport data={rec || {}} fallbackFindings={findingRows} currentTask={currentTask} docId={docId} siteName={siteName(currentTask?.siteId)} />
    </div>
  )
}

// ============================================================================
// MODULE 3: AUDITEE WORKPLACE
// ============================================================================
const AuditeeWorkplace = ({ session, users, findings }) => {
  const [selected, setSelected] = useState(null)
  const [modal, setModal] = useState(false)
  const [current, setCurrent] = useState(null)
  const [form, setForm] = useState({ rootCause: '', correction: '', capa: '', owner: '', targetDate: '', evidenceFile: null, evidenceFileName: '' })
  const myName = session.name

  const myAudits = useMemo(
    () => findings.filter((f) => f.taskDetails?.auditee === session.user),
    [findings, session.user],
  )

  // keep the selected record fresh as live data updates
  useEffect(() => {
    if (selected) {
      const fresh = myAudits.find((a) => a.firebaseKey === selected.firebaseKey)
      if (fresh && fresh !== selected) setSelected(fresh)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myAudits])

  const openResp = (f) => {
    setCurrent(f)
    setForm({
      rootCause: f.response?.rootCause || '', correction: f.response?.correction || '', capa: f.response?.capa || '',
      owner: f.response?.owner || '', targetDate: f.response?.targetDate || f.auditeeDueDate || new Date().toISOString().split('T')[0],
      evidenceFile: f.response?.evidenceFile || null, evidenceFileName: f.response?.evidenceFileName || '',
    })
    setModal(true)
  }

  const handleFile = async (e) => {
    const file = e.target.files[0]
    if (file) {
      if (file.size > 10 * 1024 * 1024) return alert('File size exceeds 10MB limit.')
      if (!file.type.match('^(image/.*|application/pdf)$')) return alert('Only PDF and image files are allowed.')
      const b64 = await fileToBase64(file); setForm({ ...form, evidenceFile: b64, evidenceFileName: file.name })
    }
  }

  const saveResponse = () => {
    if (!form.rootCause || !form.correction || !form.capa || !form.owner || !form.targetDate)
      return alert('Please fill all required fields, including CAPA Owner and Date.')
    const updated = (selected.findings || []).map((f) => (f.id === current.id ? { ...f, response: { ...form, status: 'Completed', capaStatus: 'Open' } } : f))
    setSelected({ ...selected, findings: updated })
    setModal(false)
  }

  const submit = async () => {
    const allDone = (selected.findings || []).every((f) => f.response?.status === 'Completed')
    if (!allDone) return alert('Please provide a response for ALL findings before submitting.')
    const updated = { ...selected, status: 'Submitted for Verification', submissionDate: new Date().toISOString() }
    try {
      await updateAuditFinding(session.orgId, selected.firebaseKey, { findings: updated.findings, status: updated.status, submissionDate: updated.submissionDate })
      alert('Audit response submitted successfully!')
      setSelected(updated)
    } catch (e) { alert('Submission failed: ' + e.message) }
  }

  const editable = selected && selected.status === 'Reported'

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-extrabold text-ink-800"><UserPen size={20} className="inline mr-2 text-amber-500" /> Auditee Workplace</h2>
          <p className="text-sm text-slate-500">Respond to findings and submit corrective actions.</p>
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* inbox */}
        <div className={`${panel} flex w-full flex-col overflow-hidden lg:w-1/3`}>
          <div className="border-b border-slate-100 bg-slate-50 p-5">
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-ink-800"><Inbox size={14} className="text-amber-500" /> Action Inbox <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] text-white">{myAudits.length}</span></h3>
          </div>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto p-4">
            {myAudits.length === 0 && <div className="mx-2 mt-6 rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center text-sm italic text-slate-400">No audits in your inbox.</div>}
            {myAudits.map((a) => {
              const tone = a.status === 'Reported' ? 'border-l-rose-500' : a.status === 'Submitted for Verification' ? 'border-l-orange-500' : 'border-l-emerald-500'
              const label = a.status === 'Reported' ? 'Action Required' : a.status === 'Submitted for Verification' ? 'Pending Approval' : 'Closed'
              return (
                <div key={a.firebaseKey} onClick={() => setSelected(a)} className={`cursor-pointer rounded-2xl border border-l-4 border-slate-200 ${tone} p-5 transition hover:bg-slate-50 ${selected?.firebaseKey === a.firebaseKey ? 'ring-2 ring-amber-300' : ''}`}>
                  <div className="mb-3 flex items-start justify-between">
                    <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[10px] font-bold text-slate-600">{a.docId}</span>
                    <span className="rounded bg-slate-100 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-slate-600">{label}</span>
                  </div>
                  <h3 className="mb-1 truncate text-base font-bold text-ink-800">{a.taskDetails?.dept} - {a.taskDetails?.area}</h3>
                  <div className="mt-3 flex justify-between border-t border-slate-100 pt-3 text-xs text-slate-400">
                    <span><List size={16} className="inline mr-1.5 text-brand-500" />{a.findings?.length || 0} Findings</span>
                    <span className="font-mono">{(a.auditDate || '').split('T')[0]}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* details */}
        <div className={`${panel} flex w-full flex-col overflow-hidden lg:w-2/3`}>
          {!selected ? (
            <div className="flex h-full flex-col items-center justify-center p-16 text-center text-slate-400">
              <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-slate-100 text-3xl text-amber-500"><FileSignature size={24} /></div>
              <p className="mb-1 text-lg font-bold text-ink-800">No Audit Selected</p>
              <p className="text-sm">Select an assignment from your inbox to respond.</p>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="border-b border-slate-100 bg-slate-50 p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="mb-1 text-2xl font-extrabold text-ink-800">Audit Findings</h2>
                    <p className="inline-block rounded-lg border border-amber-200 bg-amber-50 px-3 py-1 font-mono text-sm font-bold text-amber-600">Ref: {selected.docId}</p>
                  </div>
                  <div className="text-right text-xs text-slate-500"><div className="font-bold text-ink-800"><UserRound size={16} className="inline mr-1 text-brand-500" />{selected.auditor}</div><div className="font-mono">{(selected.auditDate || '').split('T')[0]}</div></div>
                </div>
              </div>
              <div className="max-h-[55vh] flex-1 space-y-6 overflow-y-auto p-6">
                {(selected.findings || []).map((f, i) => {
                  const has = f.response?.status === 'Completed'
                  const overdue = !has && new Date() > new Date(f.auditeeDueDate)
                  return (
                    <div key={i} className={`rounded-2xl border bg-white p-6 ${has ? 'border-emerald-300' : 'border-slate-200'}`}>
                      <div className="mb-4 flex items-start justify-between border-b border-slate-100 pb-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1 font-mono text-xs font-bold text-rose-600">{f.id}</span>
                          <span className={`rounded-lg px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${getTypeClass(f.type)}`}>{f.type}</span>
                          {f.auditeeDueDate && !has && <span className={`rounded-lg border px-3 py-1 text-[10px] font-bold uppercase ${overdue ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-orange-200 bg-orange-50 text-orange-600'}`}>Due: {f.auditeeDueDate}{overdue && ' !'}</span>}
                        </div>
                        {editable && <button onClick={() => openResp(f)} className={`rounded-xl px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-white transition active:scale-95 ${has ? 'bg-slate-500 hover:bg-slate-600' : 'bg-gradient-to-r from-amber-500 to-orange-500'}`}>{has ? <><Pencil size={16} className="inline mr-1" />Edit Reply</> : <><Reply size={16} className="inline mr-1" />Respond Now</>}</button>}
                      </div>
                      <div className="mb-2 rounded-r-lg border-l-4 border-slate-300 bg-slate-50 py-1 pl-4 text-sm text-slate-700">“{f.desc}”</div>
                      {has && <CapaSummary r={f.response} />}
                    </div>
                  )
                })}
              </div>
              <div className="flex justify-end border-t border-slate-100 bg-slate-50 p-5">
                {editable ? (
                  <button onClick={submit} disabled={!(selected.findings || []).every((f) => f.response?.status === 'Completed')} className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 px-10 py-3 text-sm font-bold uppercase tracking-widest text-white shadow-lg transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"><Send size={16} className="inline mr-2" />Submit Responses to Auditor</button>
                ) : (
                  <span className={`rounded-xl border px-6 py-3 text-sm font-bold uppercase tracking-widest ${selected.status === 'Closed' ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-orange-200 bg-orange-50 text-orange-600'}`}>Status: {selected.status}</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* response modal */}
      {modal && current && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4 backdrop-blur-sm">
          <div className="flex max-h-[95vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 p-6">
              <div>
                <h2 className="flex items-center gap-3 text-xl font-extrabold text-amber-600"><Reply size={18} /> Submit Corrective Action</h2>
                <p className="mt-1 font-mono text-xs text-slate-400">Finding ID: <span className="font-bold text-ink-800">{current.id}</span></p>
              </div>
              <button onClick={() => setModal(false)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200"><X size={20} /></button>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto p-6">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <span className={lbl}>Auditor’s Finding</span>
                <p className="border-l-4 border-amber-300 py-1 pl-4 text-sm text-slate-700">“{current.desc}”</p>
              </div>
              <div><label className={lbl}>1. Root Cause Analysis</label><textarea rows="3" className={fld} value={form.rootCause} onChange={(e) => setForm({ ...form, rootCause: e.target.value })} maxLength={2000} placeholder="Why did this happen?" /></div>
              <div><label className={lbl}>2. Immediate Correction</label><input className={fld} value={form.correction} onChange={(e) => setForm({ ...form, correction: e.target.value })} maxLength={500} placeholder="What was done immediately?" /></div>
              <div><label className={lbl}>3. Corrective / Preventive Action (CAPA)</label><textarea rows="2" className={fld} value={form.capa} onChange={(e) => setForm({ ...form, capa: e.target.value })} maxLength={2000} placeholder="Long-term action to prevent recurrence" /></div>
              <div className="grid grid-cols-2 gap-5">
                <div><label className={lbl}>4. CAPA Owner</label>
                  <select className={fld} value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}>
                    <option value="">Select Assignee...</option>
                    <option value={myName}>➡️ Assign to Me</option>
                    {users.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
                  </select>
                </div>
                <div><label className={lbl}>5. Target Closure Date</label><input type="date" className={`${fld} font-mono`} value={form.targetDate} onChange={(e) => setForm({ ...form, targetDate: e.target.value })} /></div>
              </div>
              <div><label className={lbl}>6. Objective Evidence (Optional)</label>
                <input type="file" accept="application/pdf,image/*" onChange={handleFile} className="w-full text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-none file:bg-amber-500 file:px-4 file:py-2 file:font-bold file:text-white" />
                {form.evidenceFileName && <span className="mt-2 inline-block text-[10px] font-bold text-emerald-600"><CheckCircle2 size={12} className="inline mr-1" />{form.evidenceFileName}</span>}
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-100 p-5">
              <button onClick={() => setModal(false)} className="rounded-xl bg-slate-100 px-8 py-3 text-sm font-bold text-slate-700 hover:bg-slate-200">Cancel</button>
              <button onClick={saveResponse} className="rounded-xl bg-amber-600 px-10 py-3 text-sm font-bold text-white shadow-lg transition active:scale-95 hover:bg-amber-500"><Save size={16} className="inline mr-2" />Save Response</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// MODULE 4: AUDIT REPORTS
// ============================================================================
const AuditReports = ({ plans, findings, sites = [] }) => {
  const [tab, setTab] = useState('findings')
  const [filters, setFilters] = useState({ search: '', status: '', dept: '' })
  const [printData, setPrintData] = useState(null)
  const [printPlan, setPrintPlan] = useState(null)

  // sites here are remapped to { code: siteId, name }; resolve either form.
  const siteName = (id) => siteNameOf(sites, id)

  const reports = useMemo(() => [...findings].sort((a, b) => new Date(b.auditDate || 0) - new Date(a.auditDate || 0)), [findings])
  const planList = useMemo(() => [...plans].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)), [plans])

  const fReports = reports.filter((r) => {
    if (!r.taskDetails) return false
    const s = filters.search.toLowerCase()
    const ms = (r.docId || '').toLowerCase().includes(s) || (r.taskDetails.auditor || '').toLowerCase().includes(s) || (r.taskDetails.auditee || '').toLowerCase().includes(s)
    const mst = !filters.status || r.status === filters.status
    const md = !filters.dept || (r.taskDetails.dept || '').toLowerCase().includes(filters.dept.toLowerCase())
    return ms && mst && md
  })
  const fPlans = planList.filter((p) => {
    const s = filters.search.toLowerCase()
    return (p.docId || '').toLowerCase().includes(s) || (p.leadAuditor || '').toLowerCase().includes(s) || (p.siteId || '').toLowerCase().includes(s)
  })

  const statusColor = (s) => (s === 'Closed' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : s === 'Submitted for Verification' ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-rose-50 text-rose-600 border-rose-200')
  const doPrint = (r) => { setPrintPlan(null); setPrintData(r); setTimeout(() => window.print(), 100) }
  const doPrintPlan = (p) => { setPrintData(null); setPrintPlan(p); setTimeout(() => window.print(), 100) }

  return (
    <div className="animate-fade-in">
      <style>{`@media print { @page { size: A4 ${printPlan ? 'landscape' : 'portrait'}; margin: 10mm; } }`}</style>
      <div className="mb-6 flex items-center justify-between print:hidden">
        <div>
          <h2 className="text-2xl font-extrabold text-ink-800"><FileText size={20} className="inline mr-2 text-purple-500" /> Audit Reports & Schedules</h2>
          <p className="text-sm text-slate-500">Access and generate PDFs for all audits.</p>
        </div>
      </div>

      <div className="space-y-6 print:hidden">
        <div className="flex gap-3">
          <button onClick={() => setTab('findings')} className={`rounded-xl px-6 py-3 text-xs font-bold uppercase tracking-widest transition ${tab === 'findings' ? 'bg-purple-600 text-white shadow-lg' : 'bg-white text-slate-500 border border-slate-200'}`}><Search size={14} className="inline mr-2" />Findings Reports</button>
          <button onClick={() => setTab('schedules')} className={`rounded-xl px-6 py-3 text-xs font-bold uppercase tracking-widest transition ${tab === 'schedules' ? 'bg-purple-600 text-white shadow-lg' : 'bg-white text-slate-500 border border-slate-200'}`}><Calendar size={14} className="inline mr-2" />Master Schedules</button>
        </div>

        <div className={`${panel} flex flex-wrap items-center gap-4 p-5`}>
          <div className="relative min-w-[240px] flex-1">
            <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input placeholder="Search ID, Auditor, Site..." value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} className={`${fld} pl-11`} />
          </div>
          {tab === 'findings' && (
            <>
              <input placeholder="Filter Department" value={filters.dept} onChange={(e) => setFilters({ ...filters, dept: e.target.value })} className={`${fld} w-48`} />
              <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className={`${fld} w-52`}>
                <option value="">All Statuses</option><option value="Reported">Open / Reported</option><option value="Submitted for Verification">Verification Pending</option><option value="Closed">Closed</option>
              </select>
            </>
          )}
          <button onClick={() => setFilters({ search: '', status: '', dept: '' })} className="rounded-xl bg-slate-100 px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-200"><RotateCcw size={14} className="inline mr-1" />Reset</button>
        </div>

        <div className={`${panel} overflow-x-auto`}>
          {tab === 'findings' ? (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500">
                <tr><th className="p-5">Report Ref</th><th className="p-5">Date</th><th className="p-5">Auditee / Dept</th><th className="p-5 text-center">Findings</th><th className="p-5 text-center">Status</th><th className="p-5 text-right">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {fReports.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50/60">
                    <td className="p-5 font-mono text-xs font-bold text-brand-600">{r.docId}</td>
                    <td className="p-5 font-mono text-xs text-slate-500">{(r.auditDate || '').split('T')[0]}</td>
                    <td className="p-5"><div className="font-bold text-ink-800">{r.taskDetails?.dept}</div><div className="text-[10px] uppercase tracking-widest text-slate-400"><User size={12} className="inline mr-1" />{r.taskDetails?.auditee}</div></td>
                    <td className="p-5 text-center"><span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold">{r.findings?.length || 0}</span></td>
                    <td className="p-5 text-center"><span className={`rounded-lg border px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest ${statusColor(r.status)}`}>{r.status === 'Submitted for Verification' ? 'Pending Verif.' : r.status}</span></td>
                    <td className="p-5 text-right"><button onClick={() => doPrint(r)} className="ml-auto flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-white hover:bg-purple-500"><FileDown size={14} />Gen PDF</button></td>
                  </tr>
                ))}
                {fReports.length === 0 && <tr><td colSpan="6" className="p-16 text-center text-lg italic text-slate-400">No reports match your filters.</td></tr>}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500">
                <tr><th className="p-5">Schedule Ref</th><th className="p-5">Target Site</th><th className="p-5">Standard</th><th className="p-5">Lead Auditor</th><th className="p-5">Range</th><th className="p-5 text-right">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {fPlans.map((p, i) => (
                  <tr key={i} className="hover:bg-slate-50/60">
                    <td className="p-5 font-mono text-xs font-bold text-brand-600">{p.docId}</td>
                    <td className="p-5 font-bold text-ink-800">{siteName(p.siteId)}</td>
                    <td className="p-5 font-bold text-purple-600">{p.standard}</td>
                    <td className="p-5">{p.leadAuditor}</td>
                    <td className="p-5 font-mono text-xs text-slate-500">{p.startDate} to {p.endDate}</td>
                    <td className="p-5 text-right"><button onClick={() => doPrintPlan(p)} className="ml-auto flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-white hover:bg-purple-500"><FileDown size={14} />Gen PDF</button></td>
                  </tr>
                ))}
                {fPlans.length === 0 && <tr><td colSpan="6" className="p-16 text-center text-lg italic text-slate-400">No schedules match your filters.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {printData && <PrintReport data={printData} fallbackFindings={printData.findings} currentTask={printData.taskDetails} docId={printData.docId} siteName={siteName(printData?.taskDetails?.siteId)} />}
      {printPlan && <PrintPlan plan={printPlan} rows={printPlan.matrix || []} siteName={siteName(printPlan.siteId)} />}
    </div>
  )
}

// ============================================================================
// MODULE 5: AUDIT DASHBOARD
// ============================================================================
const AuditDashboard = ({ findings, sites = [] }) => {
  const siteName = (id) => siteNameOf(sites, id)
  const [selected, setSelected] = useState(null)
  const stats = useMemo(() => ({
    open: findings.filter((a) => a.status === 'Reported').length,
    inProgress: findings.filter((a) => a.status === 'Submitted for Verification').length,
    closed: findings.filter((a) => a.status === 'Closed').length,
    total: findings.length,
  }), [findings])

  const color = (s) => (s === 'Reported' ? 'text-rose-600 bg-rose-50 border-rose-200' : s === 'Submitted for Verification' ? 'text-orange-600 bg-orange-50 border-orange-200' : s === 'Closed' ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : 'text-slate-500')
  const label = (s) => (s === 'Reported' ? 'Open Finding' : s === 'Submitted for Verification' ? 'Verif. Pending' : s)

  const cards = [
    ['Open Findings', stats.open, AlertTriangle, 'text-rose-600', 'bg-rose-100'],
    ['In Progress', stats.inProgress, Hourglass, 'text-orange-600', 'bg-orange-100'],
    ['Closed', stats.closed, CheckCircle2, 'text-emerald-600', 'bg-emerald-100'],
    ['Total Audits', stats.total, Layers, 'text-brand-600', 'bg-brand-100'],
  ]

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-extrabold text-ink-800"><PieChart size={20} className="inline mr-2 text-orange-500" /> Audit Dashboard</h2>
          <p className="text-sm text-slate-500">Real-time status of all organizational audits.</p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map(([l, v, Icon, txt, chipBg], i) => (
          <div key={l} style={{ animationDelay: `${i * 55}ms` }} className="clay-rise flex items-center gap-4 p-5">
            <span className={`clay-chip grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${chipBg} ${txt}`}>
              <Icon size={20} />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{l}</div>
              <div className={`text-3xl font-black ${txt}`}>{v}</div>
            </div>
          </div>
        ))}
      </div>

      <div className={`${panel} overflow-x-auto`}>
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <h3 className="flex items-center gap-2 text-base font-bold text-ink-800"><List size={16} className="text-brand-500" /> Live Audit Records</h3>
          <span className="text-[10px] uppercase tracking-widest text-slate-400">Click row for details</span>
        </div>
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500">
            <tr><th className="p-5">Ref ID</th><th className="p-5">Status</th><th className="p-5">Date</th><th className="p-5">Department</th><th className="p-5">Auditor</th><th className="p-5">Auditee</th><th className="p-5 text-center">Findings</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {findings.map((a, i) => (
              <tr key={i} onClick={() => setSelected(a)} className="cursor-pointer hover:bg-slate-50/60">
                <td className="p-5 font-mono text-xs font-bold text-brand-600">{a.docId}</td>
                <td className="p-5"><span className={`rounded-lg border px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest ${color(a.status)}`}>{label(a.status)}</span></td>
                <td className="p-5 font-mono text-xs text-slate-500">{(a.auditDate || '').split('T')[0]}</td>
                <td className="p-5 font-bold text-ink-800">{a.taskDetails?.dept}</td>
                <td className="p-5">{a.auditor}</td>
                <td className="p-5 italic text-slate-500">{a.taskDetails?.auditee}</td>
                <td className="p-5 text-center"><span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold">{a.findings?.length || 0}</span></td>
              </tr>
            ))}
            {findings.length === 0 && <tr><td colSpan="7" className="p-16 text-center text-lg italic text-slate-400">No audit records found.</td></tr>}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4 backdrop-blur-sm">
          <div className="flex max-h-[95vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 bg-slate-50 p-6">
              <div><h2 className="mb-1 text-2xl font-extrabold text-ink-800">Audit Details</h2><p className="inline-block rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 font-mono text-sm font-bold text-emerald-600">Ref: {selected.docId}</p></div>
              <button onClick={() => setSelected(null)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200"><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="mb-8 grid grid-cols-2 gap-5 rounded-2xl border border-slate-200 bg-slate-50 p-6 md:grid-cols-4">
                {[['Site', siteName(selected.taskDetails?.siteId)], ['Date', (selected.auditDate || '').split('T')[0]], ['Auditor', selected.auditor], ['Auditee', selected.taskDetails?.auditee], ['Department', selected.taskDetails?.dept], ['Area', selected.taskDetails?.area]].map(([k, v]) => (
                  <div key={k}><label className={lbl}>{k}</label><span className="text-sm font-bold text-ink-800">{v || '—'}</span></div>
                ))}
              </div>
              <FindingList findings={selected.findings} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// MODULE 6: AUDIT CALENDAR
// ============================================================================
const AuditCalendar = ({ sites, plans, findings }) => {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth())
  const [year, setYear] = useState(now.getFullYear())
  const [siteFilter, setSiteFilter] = useState('All')

  const events = useMemo(() => {
    const ev = []
    plans.forEach((plan) => {
      if (siteFilter !== 'All' && plan.siteId !== siteFilter) return
      ;(plan.matrix || []).forEach((m) => { if (m.date) ev.push({ date: m.date, type: 'scheduled', label: `Scheduled: ${m.dept}`, ref: plan.docId }) })
    })
    findings.forEach((f) => {
      if (siteFilter !== 'All' && f.taskDetails?.siteId !== siteFilter) return
      if (f.auditDate) ev.push({ date: f.auditDate.split('T')[0], type: 'assigned', label: 'Executed', ref: f.docId })
      if (f.submissionDate) ev.push({ date: f.submissionDate.split('T')[0], type: 'replied', label: 'Auditee Replied', ref: f.docId })
      if (f.closureDate) ev.push({ date: f.closureDate.split('T')[0], type: 'closed', label: 'Closed', ref: f.docId })
    })
    return ev
  }, [plans, findings, siteFilter])

  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const today = new Date().toISOString().split('T')[0]

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-extrabold text-ink-800"><CalendarDays size={20} className="inline mr-2 text-indigo-500" /> Audit Calendar</h2>
          <p className="text-sm text-slate-500">Visual timeline of audit schedules and milestones.</p>
        </div>
      </div>

      <div className={`${panel} mb-5 flex flex-wrap items-center justify-between gap-4 p-5`}>
        <div className="flex items-center gap-3">
          <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Site View:</label>
          <select className={`${fld} w-56`} value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
            <option value="All">All Sites</option>
            {sites.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1.5">
          <button onClick={() => { if (month === 0) { setMonth(11); setYear((y) => y - 1) } else setMonth((m) => m - 1) }} className="rounded-lg px-4 py-2 text-slate-500 hover:bg-white"><ChevronLeft size={16} className="inline" /></button>
          <span className="w-40 text-center text-sm font-bold text-ink-800">{months[month]} {year}</span>
          <button onClick={() => { if (month === 11) { setMonth(0); setYear((y) => y + 1) } else setMonth((m) => m + 1) }} className="rounded-lg px-4 py-2 text-slate-500 hover:bg-white"><ChevronRight size={16} className="inline" /></button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap justify-center gap-6 rounded-2xl border border-slate-200 bg-white p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">
        {[['bg-sky-500', 'Scheduled'], ['bg-orange-500', 'Assigned'], ['bg-yellow-400', 'Replied'], ['bg-emerald-500', 'Closed']].map(([c, l]) => (
          <span key={l} className="flex items-center"><span className={`mr-2 h-3 w-3 rounded-full ${c}`} /> {l}</span>
        ))}
      </div>

      <div className={`${panel} p-6`}>
        <div className="grid grid-cols-7 overflow-hidden rounded-xl border-l border-t border-slate-200">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} className="border-b border-r border-slate-200 bg-slate-50 p-3 text-center text-xs font-bold uppercase tracking-widest text-slate-500">{d}</div>
          ))}
          {(() => {
            const daysIn = new Date(year, month + 1, 0).getDate()
            const first = new Date(year, month, 1).getDay()
            const boxes = []
            for (let i = 0; i < first; i++) boxes.push(<div key={`e${i}`} className="min-h-[120px] border-b border-r border-slate-100 bg-slate-50/50" />)
            for (let d = 1; d <= daysIn; d++) {
              const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
              const dayEvents = events.filter((e) => e.date === ds)
              boxes.push(
                <div key={d} className="flex min-h-[120px] flex-col border-b border-r border-slate-100 bg-white p-2">
                  <span className={`mb-2 block text-right text-sm font-bold ${today === ds ? 'text-indigo-600' : 'text-slate-400'}`}>{d}</span>
                  <div className="flex-1 space-y-1 overflow-y-auto">
                    {dayEvents.map((ev, i) => {
                      const tone = ev.type === 'scheduled' ? 'bg-sky-50 border-sky-200 text-sky-700' : ev.type === 'assigned' ? 'bg-orange-50 border-orange-200 text-orange-700' : ev.type === 'replied' ? 'bg-yellow-50 border-yellow-200 text-yellow-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      return <div key={i} title={`${ev.label} - ${ev.ref}`} className={`truncate rounded border p-1.5 text-[9px] font-bold leading-tight ${tone}`}><div className="uppercase">{ev.label}</div><div className="font-mono text-[8px] opacity-70">{ev.ref}</div></div>
                    })}
                  </div>
                </div>,
              )
            }
            return boxes
          })()}
        </div>
      </div>
    </div>
  )
}

// ---- small shared presentational pieces -------------------------------------
function CapaSummary({ r }) {
  return (
    <div className="mt-4 rounded-xl border-l-4 border-orange-400 bg-orange-50/50 p-5">
      <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-orange-600"><Reply size={14} /> Auditee Corrective Action Plan</div>
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4"><span className={lbl}>Root Cause</span><span className="text-sm font-medium text-ink-800">{r.rootCause}</span></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><span className={lbl}>CAPA</span><span className="text-sm font-medium text-ink-800">{r.capa}</span></div>
      </div>
      <div className="flex items-center justify-between border-t border-orange-200 pt-3">
        {r.evidenceFileName ? <a href={safeHref(r.evidenceFile)} download={r.evidenceFileName} className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-600 hover:bg-emerald-600 hover:text-white"><Download size={14} />View Evidence</a> : <span className="text-xs italic text-slate-400">No Evidence Provided</span>}
        <div className="flex gap-6 text-right">
          <div><span className={lbl}>Owner</span><span className="text-xs font-bold text-ink-800">{r.owner}</span></div>
          <div><span className={lbl}>Target</span><span className="font-mono text-xs text-ink-800">{r.targetDate}</span></div>
        </div>
      </div>
    </div>
  )
}

function FindingList({ findings }) {
  return (
    <>
      <h3 className="mb-6 flex items-center gap-2 border-b border-slate-100 pb-2 text-xs font-bold uppercase tracking-widest text-brand-600"><ListChecks size={14} /> Documented Findings ({(findings || []).length})</h3>
      <div className="space-y-6">
        {(findings || []).map((f, i) => (
          <div key={i} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-6">
            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-3">
                <span className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 font-mono text-xs font-bold text-rose-600">{f.id}</span>
                <span className={`rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${getTypeClass(f.type)}`}>{f.type}</span>
              </div>
              <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">Clause: <span className="text-ink-800">{f.clause}</span></span>
            </div>
            <p className="mb-2 rounded-r-lg border-l-4 border-slate-300 bg-white py-1 pl-4 text-sm text-slate-700">“{f.desc}”</p>
            {f.response?.status === 'Completed' ? <CapaSummary r={f.response} /> : <div className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-center text-xs italic text-slate-400">No response submitted by auditee yet.</div>}
          </div>
        ))}
      </div>
    </>
  )
}

// ---- print layouts (black/white, used by window.print) ----------------------
function PrintReport({ data, fallbackFindings, currentTask, docId, siteName }) {
  const td = data?.taskDetails || currentTask || {}
  const list = data?.findings || fallbackFindings || []
  return (
    <div className="absolute inset-0 z-[9999] hidden min-h-screen bg-white p-10 text-black print:block" style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
      <div className="mb-8 flex items-end justify-between border-b-4 border-black pb-4">
        <div><div className="mb-1 text-sm font-bold uppercase tracking-widest text-gray-500">ISO 45001 OHSMS - Formal Record</div><h1 className="text-3xl font-black uppercase leading-none tracking-tighter">Internal Audit Report</h1></div>
        <div className="text-right"><p className="font-mono text-sm font-bold">Ref: {data?.docId || docId}</p><p className="mt-1 text-sm font-bold uppercase">Date: {(data?.auditDate || new Date().toISOString()).split('T')[0]}</p></div>
      </div>
      <table className="mb-8 w-full border border-black text-sm">
        <tbody>
          <tr><td className="border-b border-gray-300 p-2 font-bold">Site:</td><td className="border-b border-gray-300 p-2">{siteName || td.siteId}</td><td className="border-b border-gray-300 p-2 font-bold">Standard:</td><td className="border-b border-gray-300 p-2">{td.standard}</td></tr>
          <tr><td className="border-b border-gray-300 p-2 font-bold">Auditor:</td><td className="border-b border-gray-300 p-2">{td.auditor || data?.auditor}</td><td className="border-b border-gray-300 p-2 font-bold">Lead Auditor:</td><td className="border-b border-gray-300 p-2">{td.leadAuditor}</td></tr>
          <tr><td className="p-2 font-bold">Auditee:</td><td className="p-2">{td.auditee}</td><td className="p-2 font-bold">Dept / Area:</td><td className="p-2">{td.dept} / {td.area}</td></tr>
        </tbody>
      </table>
      <h2 className="mb-4 inline-block border border-gray-400 bg-gray-200 p-1 text-sm font-bold uppercase">1. Findings Summary</h2>
      <table className="mb-8 w-full border-collapse border border-black text-sm">
        <thead><tr className="bg-gray-200"><th className="border border-black p-2">ID</th><th className="border border-black p-2">Type</th><th className="border border-black p-2">Clause</th><th className="border border-black p-2 text-left">Description</th></tr></thead>
        <tbody>{list.map((f, i) => <tr key={i}><td className="border border-black p-2 text-center font-mono font-bold">{f.id}</td><td className="border border-black p-2 text-center font-bold">{f.type}</td><td className="border border-black p-2 text-center">{f.clause}</td><td className="border border-black p-2">{f.desc}</td></tr>)}</tbody>
      </table>
      <h2 className="mb-4 inline-block border border-gray-400 bg-gray-200 p-1 text-sm font-bold uppercase">2. Corrective Action Report (CAR)</h2>
      {list.map((f, i) => (
        <div key={i} className="mb-6 border border-black p-5">
          <div className="mb-3 flex justify-between border-b border-gray-300 pb-2"><span className="font-bold">Finding {f.id}</span><span className="border border-black px-2 py-0.5 text-xs font-bold uppercase">{f.type}</span></div>
          <div className="mb-4 border-l-4 border-gray-400 pl-3 text-sm italic text-gray-700">“{f.desc}”</div>
          {f.response?.status === 'Completed' ? (
            <div className="border border-gray-300 bg-gray-50 p-4 text-sm">
              <div className="mb-3"><strong>Root Cause:</strong><br />{f.response.rootCause}</div>
              <div className="mb-3"><strong>Immediate Correction:</strong><br />{f.response.correction}</div>
              <div className="mb-4"><strong>Corrective Action (CAPA):</strong><br />{f.response.capa}</div>
              <div className="flex justify-between border-t border-gray-300 pt-3 text-xs"><div><strong>Owner:</strong> {f.response.owner}</div><div><strong>Target:</strong> {f.response.targetDate}</div><div><strong>Evidence:</strong> {f.response.evidenceFileName || 'None'}</div></div>
            </div>
          ) : <div className="text-sm font-bold italic text-red-600">No corrective action submitted yet.</div>}
        </div>
      ))}
      <table className="mt-24 w-full text-sm"><tbody><tr><td className="w-[45%] border-t-2 border-black pt-2 text-center font-bold uppercase tracking-widest">Auditor Signature</td><td className="w-[10%]" /><td className="w-[45%] border-t-2 border-black pt-2 text-center font-bold uppercase tracking-widest">Auditee Signature</td></tr></tbody></table>
    </div>
  )
}

function PrintPlan({ plan, rows, siteName }) {
  return (
    <div className="absolute inset-0 z-[9999] hidden min-h-screen bg-white p-10 text-black print:block" style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
      <div className="mb-8 flex items-end justify-between border-b-4 border-black pb-4">
        <div><div className="mb-1 text-sm font-bold uppercase tracking-widest text-gray-500">ISO 45001 OHSMS - Formal Record</div><h1 className="text-3xl font-black uppercase leading-none tracking-tighter">Internal Audit Schedule & Matrix</h1></div>
        <div className="text-right"><p className="font-mono text-sm font-bold">Ref ID: {plan.docId || 'DRAFT'}</p><p className="mt-1 text-sm font-bold uppercase">Printed: {new Date().toLocaleDateString()}</p></div>
      </div>
      <div className="mb-8 border border-black bg-gray-50 p-6">
        <table className="w-full text-sm">
          <tbody>
            <tr><td className="border-b border-gray-300 p-2 font-bold">Target Site:</td><td className="border-b border-gray-300 p-2 text-lg font-bold">{siteName || plan.siteId || 'N/A'}</td><td className="border-b border-gray-300 p-2 font-bold">Lead Auditor:</td><td className="border-b border-gray-300 p-2">{plan.leadAuditor || 'N/A'}</td></tr>
            <tr><td className="border-b border-gray-300 p-2 font-bold">Standard:</td><td className="border-b border-gray-300 p-2">{plan.standard}</td><td className="border-b border-gray-300 p-2 font-bold">Date Range:</td><td className="border-b border-gray-300 p-2 font-mono">{plan.startDate} to {plan.endDate}</td></tr>
            <tr><td className="p-2 font-bold">Audit Team:</td><td className="p-2" colSpan="3">{(plan.team || []).join(', ') || 'None assigned'}</td></tr>
          </tbody>
        </table>
      </div>
      <h2 className="mb-4 inline-block border border-gray-400 bg-gray-200 p-1 text-sm font-bold uppercase">Execution Matrix</h2>
      <table className="w-full border-collapse border border-black text-xs">
        <thead><tr className="bg-gray-200"><th className="border border-black p-2 text-left">Auditor</th><th className="border border-black p-2 text-left">Auditee</th><th className="border border-black p-2 text-left">Department</th><th className="border border-black p-2 text-left">Area</th><th className="border border-black p-2 text-left">Aspect</th><th className="border border-black p-2">Date</th><th className="border border-black p-2">Time</th></tr></thead>
        <tbody>{(rows || []).map((r, i) => <tr key={i}><td className="border border-black p-2 font-bold">{r.auditor}</td><td className="border border-black p-2 font-bold">{r.auditee}</td><td className="border border-black p-2">{r.dept}</td><td className="border border-black p-2">{r.area}</td><td className="border border-black p-2">{r.aspect}</td><td className="border border-black p-2 text-center font-mono">{r.date}</td><td className="border border-black p-2 text-center font-mono">{r.time}</td></tr>)}</tbody>
      </table>
      <table className="mt-24 w-full text-sm"><tbody><tr><td className="w-[45%] border-t-2 border-black pt-2 text-center font-bold uppercase tracking-widest">Lead Auditor Signature</td><td className="w-[10%]" /><td className="w-[45%] border-t-2 border-black pt-2 text-center font-bold uppercase tracking-widest">Management Rep Signature</td></tr></tbody></table>
    </div>
  )
}

function hashStr(s = '') {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i)
  return h
}

// ============================================================================
// MASTER HUB
// ============================================================================
export default function InternalAudit() {
  const { profile, org, isAdmin } = useAuth()
  const { sites: rawSites, users: rawUsers, locations, siteInventory } = useOrgData()
  const [view, setView] = useState('hub')
  const [plans, setPlans] = useState([])
  const [findings, setFindings] = useState([])

  const orgId = org?.id

  useEffect(() => {
    if (!orgId) return undefined
    const unsubs = [
      subscribeAuditPlans(orgId, setPlans),
      subscribeAuditFindings(orgId, setFindings),
    ]
    return () => unsubs.forEach((u) => u && u())
  }, [orgId])

  // Let Sam's guided tour open a module tab (e.g. dispatch 'sam:view').
  useEffect(() => {
    const handler = (e) => setView(e.detail === 'home' ? 'hub' : e.detail)
    window.addEventListener('sam:view', handler)
    return () => window.removeEventListener('sam:view', handler)
  }, [])

  const session = useMemo(
    () => ({ orgId, user: profile?.name, name: profile?.name, email: profile?.email, role: profile?.role }),
    [orgId, profile],
  )
  const sites = useMemo(() => rawSites.map((s) => ({ code: s.id, name: s.name })), [rawSites])
  const users = useMemo(
    () => rawUsers.filter((u) => u.status === 'approved').map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status })),
    [rawUsers],
  )

  const shared = { setView, session, isGlobalOwner: isAdmin, sites, users, plans, findings, locations, siteInventory }

  const TILES = [
    ['scheduler', 'Scheduler', Calendar, 'text-sky-600', 'bg-sky-100', 'Plan annual audits & assign auditors'],
    ['auditor', 'Auditor Workplace', ClipboardList, 'text-emerald-600', 'bg-emerald-100', 'Execute audits & record findings'],
    ['auditee', 'Auditee Workplace', UserPen, 'text-amber-600', 'bg-amber-100', 'Submit corrections & evidence'],
    ['reports', 'Reports', FileText, 'text-purple-600', 'bg-purple-100', 'Verify closure & generate PDFs'],
    ['calendar', 'Calendar', CalendarDays, 'text-indigo-600', 'bg-indigo-100', 'Visual lifecycle timeline'],
    ['dashboard', 'Dashboard', PieChart, 'text-orange-600', 'bg-orange-100', 'Analytics & trends'],
  ]

  const moduleEl = {
    scheduler: <AuditScheduler {...shared} />,
    auditor: <AuditorWorkplace {...shared} />,
    auditee: <AuditeeWorkplace {...shared} />,
    reports: <AuditReports {...shared} />,
    calendar: <AuditCalendar {...shared} />,
    dashboard: <AuditDashboard {...shared} />,
  }[view]

  // A module is open — show it with a "back to hub" control.
  if (moduleEl) {
    return (
      <div className="animate-fade-in">
        <button
          onClick={() => setView('hub')}
          className="mb-4 inline-flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-200 print:hidden"
        >
          <ArrowLeft size={16} /> Back to Hub
        </button>
        {moduleEl}
      </div>
    )
  }

  // Landing hub — six module tiles.
  return (
    <div className="animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-800"><ClipboardCheck size={20} className="inline mr-2 text-brand-500" /> Internal Audit Hub</h1>
        <p className="mt-1 text-sm text-slate-500">ISO 45001 audit lifecycle — plan, execute, correct, verify and report.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map(([key, title, Icon, color, chipBg, desc], i) => (
          <button
            key={key}
            data-tour={key}
            onClick={() => setView(key)}
            style={{ animationDelay: `${i * 55}ms` }}
            className="clay-tile flex items-center gap-4 p-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/50"
          >
            <span className={`clay-chip grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${chipBg} ${color}`}>
              <Icon size={24} />
            </span>
            <span className="min-w-0">
              <span className="block text-base font-bold text-ink-800">{title}</span>
              <span className="block truncate text-xs text-slate-400">{desc}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
