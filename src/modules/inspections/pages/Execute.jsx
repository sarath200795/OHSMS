import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ClipboardCheck, ArrowLeft, Check, X, Minus, Camera, Trash2, Send, MapPin,
} from 'lucide-react'
import { PageHeader, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { addRecord } from '../lib/firestore'
import { fileToDataUrl } from '../lib/fileToDataUrl'
import { hasAnsweredQuestion, scoreResponses } from '../lib/schedule'
import { previousInspection, withRepeatHistory } from '../lib/previousFindings'
import PreviousFindingsPanel, { PreviousFindingNote } from '../components/PreviousFindings'

export default function Execute() {
  const navigate = useNavigate()
  const location = useLocation()
  const { profile, orgId } = useAuth()
  const { sites, records } = useData()
  const task = location.state?.task

  const [responses, setResponses] = useState({})
  const [inspArea, setInspArea] = useState('')
  const [inspSiteId, setInspSiteId] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!task) return
    setInspArea(task.area || '')
    setInspSiteId(task.siteId || '')
    const init = {}
    ;(task.template?.fields || []).forEach((f) => {
      init[f.id] = { label: f.label, type: f.type, answer: f.type === 'Multiple Choice' ? [] : '', observation: '', photoEvidence: null, photoEvidenceName: '' }
    })
    setResponses(init)
  }, [task])

  // Memoised because `|| []` is a fresh array every render, which would make
  // every memo downstream of it recompute on each keystroke.
  const fields = useMemo(() => task?.template?.fields || [], [task])

  const progress = useMemo(() => {
    let answered = 0, photoNeed = 0, photoOk = 0
    fields.forEach((f) => {
      const r = responses[f.id]
      if (hasAnsweredQuestion(f, r)) answered += 1
      if (f.photoRequirement === 'Mandatory') {
        photoNeed += 1
        if (r?.photoEvidence) photoOk += 1
      }
    })
    return { total: fields.length, answered, percent: fields.length ? Math.round((answered / fields.length) * 100) : 0, photoNeed, photoOk }
  }, [fields, responses])

  const live = useMemo(() => scoreResponses(responses), [responses])

  // What the last run of this form at this site found. Keyed on the site the
  // inspector actually selects, not the scheduled one, so picking a different
  // site swaps the history rather than showing another site's findings.
  const previous = useMemo(
    () => previousInspection(records, {
      templateId: task?.templateId,
      siteId: inspSiteId || task?.siteId || '',
      fields,
    }),
    [records, task?.templateId, task?.siteId, inspSiteId, fields]
  )

  if (!task) {
    return (
      <div>
        <PageHeader icon={ClipboardCheck} title="Run inspection" />
        <div className="card p-8 text-center text-sm text-ink-500">
          No inspection selected. Pick one from the{' '}
          <button className="font-semibold text-brand-600 hover:underline" onClick={() => navigate('/inspections/schedule')}>Schedule</button>{' '}
          or <button className="font-semibold text-brand-600 hover:underline" onClick={() => navigate('/inspections/overdue')}>Overdue</button> list.
        </div>
      </div>
    )
  }

  const update = (fid, patch) => setResponses((p) => ({ ...p, [fid]: { ...(p[fid] || {}), ...patch } }))

  const onPhoto = async (fid, e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 900 * 1024) { toast.error('Photo too large (max ~900 KB).'); e.target.value = ''; return }
    const data = await fileToDataUrl(file)
    update(fid, { photoEvidence: data, photoEvidenceName: file.name })
    e.target.value = ''
  }

  const submit = async () => {
    const errors = []
    fields.forEach((f, i) => {
      const r = responses[f.id]
      if (!hasAnsweredQuestion(f, r)) errors.push(`Question ${i + 1} is unanswered.`)
      if (f.photoRequirement === 'Mandatory' && !r?.photoEvidence) errors.push(`Question ${i + 1} requires a photo.`)
    })
    if (errors.length) return toast.error(errors[0] + (errors.length > 1 ? ` (+${errors.length - 1} more)` : ''))

    const { score, result } = scoreResponses(responses)
    // Each failure is already an action in the tracker. Stamping the repeat
    // chain here is what lets a fault failing for the third month running be
    // told apart from one found today.
    const stamped = withRepeatHistory(responses, previous)
    const site = sites.find((s) => s.id === inspSiteId)
    const record = {
      templateId: task.templateId,
      templateTitle: task.title,
      siteId: inspSiteId || '',
      siteName: site?.name || task.siteName || '',
      area: inspArea.trim(),
      ...(task.assignmentId ? { assignmentId: task.assignmentId } : {}),
      inspector: profile?.name || '',
      completedAt: new Date().toISOString(),
      scheduledFor: task.dueString || '',
      dueString: task.dueString || '',
      frequency: task.frequency || '',
      score,
      passFailResult: result,
      responses: stamped,
    }
    setBusy(true)
    try {
      await addRecord(orgId, record, profile)
      toast.success(`Inspection submitted — ${score}% (${result})`)
      navigate('/inspections/records')
    } catch (e) {
      toast.error('Submit failed: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const PF = ({ fid, value }) => {
    const opts = [
      { v: 'Pass', icon: Check, on: 'bg-emerald-500 text-white', off: 'text-emerald-600' },
      { v: 'Fail', icon: X, on: 'bg-red-500 text-white', off: 'text-red-600' },
      { v: 'N/A', icon: Minus, on: 'bg-ink-400 text-white', off: 'text-ink-500' },
    ]
    return (
      <div className="flex gap-2">
        {opts.map((o) => (
          <button key={o.v} type="button"
            onClick={() => update(fid, { answer: o.v, observation: o.v === 'Fail' ? responses[fid]?.observation || '' : '' })}
            className={`inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold shadow-clay-sm transition active:scale-95 ${value === o.v ? o.on : `bg-clay-surface ${o.off}`}`}>
            <o.icon size={14} /> {o.v}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div>
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-2 text-sm text-ink-500 hover:text-ink-800">
        <ArrowLeft size={16} /> Back
      </button>
      <PageHeader icon={ClipboardCheck} title={task.title} subtitle={`${task.frequency || 'One-off'}${task.dueString ? ' · due ' + task.dueString : ''}`} />

      {/* Progress + meta */}
      <div className="card mb-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-[220px] flex-1">
            <div className="mb-1 flex justify-between text-xs font-semibold text-ink-500">
              <span>{progress.answered}/{progress.total} answered</span>
              <span>{progress.percent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-clay-200">
              <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${progress.percent}%` }} />
            </div>
            {progress.photoNeed > 0 && (
              <p className="mt-1.5 text-[11px] text-ink-400">{progress.photoOk}/{progress.photoNeed} mandatory photos attached</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">Live score</p>
            <p className={`text-2xl font-black ${live.result === 'PASS' ? 'text-emerald-600' : 'text-red-600'}`}>{live.score}%</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label"><MapPin size={12} className="mr-1 inline" /> Site</label>
            {task.siteId && task.siteName ? (
              <div className="input flex items-center bg-clay-bg font-semibold text-ink-700">{task.siteName}</div>
            ) : (
              <select className="input" value={inspSiteId} onChange={(e) => setInspSiteId(e.target.value)}>
                <option value="">{sites.length ? 'Select a site…' : 'No sites available'}</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ''}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className="label">Area / sub-location (optional)</label>
            <input className="input" value={inspArea} placeholder="e.g. Warehouse B" onChange={(e) => setInspArea(e.target.value)} />
          </div>
        </div>
      </div>

      {/* What the last run of this form found here, before anything is answered. */}
      <PreviousFindingsPanel previous={previous} />

      {/* Questions */}
      <div className="space-y-3">
        {fields.map((f, i) => {
          const r = responses[f.id] || {}
          const lastFail = previous?.byField.get(f.id)
          return (
            <div key={f.id} className={`card p-5 ${lastFail ? 'border-l-4 border-amber-300' : ''}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex-1">
                  <p className="font-semibold text-ink-800">
                    <span className="mr-2 text-ink-400">{i + 1}.</span>{f.label}
                  </p>
                  <div className="mt-1 flex gap-2 text-[10px] font-bold uppercase tracking-widest text-ink-400">
                    <span>{f.type}</span>
                    {f.photoRequirement !== 'Not Required' && <span className="text-brand-600">📷 {f.photoRequirement}</span>}
                  </div>
                  <PreviousFindingNote finding={lastFail} />
                </div>
                <div>
                  {f.type === 'Pass/Fail' && <PF fid={f.id} value={r.answer} />}
                  {f.type === 'Number' && (
                    <input type="number" className="input w-40" placeholder="Value" value={r.answer}
                      onChange={(e) => update(f.id, { answer: e.target.value })} />
                  )}
                  {f.type === 'Text Input' && (
                    <input className="input w-56" placeholder="Answer" value={r.answer}
                      onChange={(e) => update(f.id, { answer: e.target.value })} />
                  )}
                  {f.type === 'Single Choice' && (
                    <div className="flex max-w-md flex-wrap justify-end gap-2">
                      {(f.options || []).map((opt) => {
                        const sel = r.answer === opt
                        return (
                          <button key={opt} type="button" onClick={() => update(f.id, { answer: opt })}
                            className={`rounded-xl px-3 py-2 text-xs font-bold shadow-clay-sm transition active:scale-95 ${sel ? 'bg-brand-500 text-white' : 'bg-clay-surface text-ink-600'}`}>
                            {opt}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {f.type === 'Multiple Choice' && (
                    <div className="flex max-w-md flex-wrap justify-end gap-2">
                      {(f.options || []).map((opt) => {
                        const arr = Array.isArray(r.answer) ? r.answer : []
                        const sel = arr.includes(opt)
                        return (
                          <button key={opt} type="button"
                            onClick={() => update(f.id, { answer: sel ? arr.filter((x) => x !== opt) : [...arr, opt] })}
                            className={`inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold shadow-clay-sm transition active:scale-95 ${sel ? 'bg-brand-500 text-white' : 'bg-clay-surface text-ink-600'}`}>
                            {sel && <Check size={13} />}{opt}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Observation on Fail */}
              {f.type === 'Pass/Fail' && r.answer === 'Fail' && (
                <textarea className="input mt-3 min-h-[60px]" placeholder="Describe the defect / observation…"
                  value={r.observation} onChange={(e) => update(f.id, { observation: e.target.value })} />
              )}

              {/* Photo */}
              {f.photoRequirement !== 'Not Required' && (
                <div className="mt-3">
                  {r.photoEvidence ? (
                    <div className="flex items-center gap-3">
                      <img src={r.photoEvidence} alt="evidence" className="h-16 w-16 rounded-xl object-cover shadow-clay-sm" />
                      <span className="text-xs text-ink-500">{r.photoEvidenceName}</span>
                      <button onClick={() => update(f.id, { photoEvidence: null, photoEvidenceName: '' })}
                        className="rounded-lg p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
                    </div>
                  ) : (
                    <label className="btn-ghost inline-flex cursor-pointer text-xs">
                      <Camera size={14} /> Attach photo
                      <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPhoto(f.id, e)} />
                    </label>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="sticky bottom-4 mt-6 flex justify-end">
        <button className="btn-primary shadow-glow" onClick={submit} disabled={busy}>
          {busy ? <Spinner size={16} /> : <><Send size={16} /> Submit inspection</>}
        </button>
      </div>
    </div>
  )
}
