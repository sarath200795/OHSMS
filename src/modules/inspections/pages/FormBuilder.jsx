import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import toast from 'react-hot-toast'
import {
  ClipboardCheck, Plus, Trash2, GripVertical, Download, FileUp, Save, ArrowLeft,
} from 'lucide-react'
import { PageHeader, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { addTemplate, updateTemplate } from '../lib/firestore'
import {
  FREQUENCIES, STATUSES, QUESTION_TYPES, CHOICE_TYPES, PHOTO_REQUIREMENTS,
  emptyTemplate, normalizeTemplateFields, normalizeQuestionType, normalizePhotoRequirement,
} from '../lib/schedule'

export default function FormBuilder() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile, orgId } = useAuth()
  const { templates, sites } = useData()
  const [tpl, setTpl] = useState(emptyTemplate())
  const [busy, setBusy] = useState(false)
  const editing = Boolean(id)

  useEffect(() => {
    if (!id) return
    const found = templates.find((t) => t.id === id)
    if (found) setTpl({ ...emptyTemplate(), ...found, fields: normalizeTemplateFields(found.fields || []) })
  }, [id, templates])

  const set = (patch) => setTpl((p) => ({ ...p, ...patch }))

  const addField = () => set({
    fields: [...tpl.fields, { id: `field-${Date.now()}`, label: '', type: 'Pass/Fail', photoRequirement: 'Not Required', options: [] }],
  })
  const updateField = (fid, patch) => set({ fields: tpl.fields.map((f) => (f.id === fid ? { ...f, ...patch } : f)) })
  const removeField = (fid) => set({ fields: tpl.fields.filter((f) => f.id !== fid) })

  // Per-field option helpers (Single / Multiple Choice).
  const fieldOptions = (f) => (Array.isArray(f.options) ? f.options : [])
  const addOption = (f) => updateField(f.id, { options: [...fieldOptions(f), ''] })
  const updateOption = (f, i, val) => updateField(f.id, { options: fieldOptions(f).map((o, idx) => (idx === i ? val : o)) })
  const removeOption = (f, i) => updateField(f.id, { options: fieldOptions(f).filter((_, idx) => idx !== i) })
  const isChoice = (t) => CHOICE_TYPES.includes(t)

  const downloadQuestionTemplate = () => {
    const wb = XLSX.utils.book_new()
    const questions = XLSX.utils.aoa_to_sheet([
      ['Question / Check Requirement (Required)', 'Answer Type (Required)', 'Photo Requirement (Optional)', 'Options (separate with ;)'],
      ['Are fire exits clear and unobstructed?', 'Pass/Fail', 'Optional', ''],
      ['Overall condition of the area?', 'Single Choice', 'Not Required', 'Good; Fair; Poor'],
      ['Which PPE was worn?', 'Multiple Choice', 'Not Required', 'Helmet; Gloves; Goggles; Boots'],
      ['Current pressure reading?', 'Number', 'Not Required', ''],
      ['General observations of the work area:', 'Text Input', 'Mandatory', ''],
    ])
    questions['!cols'] = [{ wch: 60 }, { wch: 25 }, { wch: 24 }, { wch: 40 }]
    const allowed = XLSX.utils.aoa_to_sheet([
      ['Allowed Answer Types'], ...QUESTION_TYPES.map((t) => [t]), [],
      ['Allowed Photo Requirement Values'], ...PHOTO_REQUIREMENTS.map((t) => [t]),
    ])
    allowed['!cols'] = [{ wch: 24 }]
    XLSX.utils.book_append_sheet(wb, questions, 'Inspection_Questions')
    XLSX.utils.book_append_sheet(wb, allowed, 'Allowed_Values')
    XLSX.writeFile(wb, 'Inspection_Questions_Template.xlsx')
  }

  const handleImport = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws)
        if (rows.length === 0) throw new Error('Sheet is empty.')
        const newFields = []
        rows.forEach((row, idx) => {
          const keys = Object.keys(row)
          const qKey = keys.find((k) => k.toLowerCase().includes('question') || k.toLowerCase().includes('requirement'))
          const tKey = keys.find((k) => k.toLowerCase().includes('type'))
          const pKey = keys.find((k) => k.toLowerCase().includes('photo'))
          const oKey = keys.find((k) => k.toLowerCase().includes('option'))
          const text = row[qKey]
          if (!text) return
          const type = normalizeQuestionType(row[tKey] || 'Pass/Fail')
          const options = isChoice(type) && oKey
            ? String(row[oKey] || '').split(';').map((s) => s.trim()).filter(Boolean)
            : []
          newFields.push({
            id: `imported-${Date.now()}-${idx}`,
            label: String(text),
            type,
            photoRequirement: normalizePhotoRequirement(row[pKey] || 'Not Required'),
            options,
          })
        })
        if (newFields.length === 0) return toast.error('No valid questions found — check the column headers.')
        set({ fields: [...tpl.fields, ...newFields] })
        toast.success(`Imported ${newFields.length} question${newFields.length === 1 ? '' : 's'}`)
      } catch (err) {
        toast.error('Failed to parse Excel: ' + err.message)
      }
      e.target.value = null
    }
    reader.readAsBinaryString(file)
  }

  const save = async () => {
    if (!tpl.title.trim()) return toast.error('A form title is required.')
    if (tpl.fields.length === 0) return toast.error('Add at least one question.')
    if (tpl.fields.some((f) => !f.label.trim())) return toast.error('Every question needs a label.')
    if (tpl.fields.some((f) => isChoice(f.type) && fieldOptions(f).map((o) => o.trim()).filter(Boolean).length < 2)) {
      return toast.error('Choice questions need at least 2 options.')
    }
    if (tpl.assignedTo && !tpl.assignedFrom) return toast.error('Set a start date before an end date.')
    if (tpl.assignedFrom && tpl.assignedTo && tpl.assignedTo < tpl.assignedFrom) return toast.error('End date is before start date.')

    const payload = {
      title: tpl.title.trim(),
      desc: tpl.desc.trim(),
      siteId: tpl.siteId || '',
      siteName: tpl.siteName || '',
      frequency: tpl.frequency,
      status: tpl.status,
      assignedFrom: tpl.assignedFrom || '',
      assignedTo: tpl.assignedTo || '',
      fields: normalizeTemplateFields(tpl.fields),
      assignments: tpl.assignments || [],
    }
    setBusy(true)
    try {
      if (editing) {
        await updateTemplate(orgId, id, payload, profile)
        toast.success('Form updated')
      } else {
        await addTemplate(orgId, payload, profile)
        toast.success('Form created')
      }
      navigate('/inspections/forms')
    } catch (err) {
      toast.error('Save failed: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const passFailCount = useMemo(() => tpl.fields.filter((f) => f.type === 'Pass/Fail').length, [tpl.fields])

  return (
    <div>
      <button onClick={() => navigate('/inspections/forms')} className="mb-4 inline-flex items-center gap-2 text-sm text-ink-500 hover:text-ink-800">
        <ArrowLeft size={16} /> Back to forms
      </button>
      <PageHeader
        icon={ClipboardCheck}
        title={editing ? 'Edit inspection form' : 'Create inspection form'}
        subtitle={editing ? tpl.title : 'Define the checks an inspector will complete'}
      >
        <button className="btn-primary" onClick={save} disabled={busy}>
          {busy ? <Spinner size={16} /> : <><Save size={16} /> {editing ? 'Save changes' : 'Create form'}</>}
        </button>
      </PageHeader>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Details */}
        <div className="card p-6 lg:col-span-1">
          <h3 className="mb-4 text-sm font-bold text-ink-800">Form details</h3>
          <div className="space-y-4">
            <div>
              <label className="label">Title *</label>
              <input className="input" value={tpl.title} placeholder="Monthly Fire Safety Check"
                onChange={(e) => set({ title: e.target.value })} />
            </div>
            <div>
              <label className="label">Description</label>
              <textarea className="input min-h-[72px]" value={tpl.desc} placeholder="What this inspection covers…"
                onChange={(e) => set({ desc: e.target.value })} />
            </div>
            <div>
              <label className="label">Default site (optional)</label>
              <select
                className="input"
                value={tpl.siteId || ''}
                onChange={(e) => {
                  const site = sites.find((s) => s.id === e.target.value)
                  set({ siteId: e.target.value, siteName: site?.name || '' })
                }}
              >
                <option value="">No default — choose per assignment</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ''}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-ink-400">
                Used when this form auto-schedules from its recurring window. The site is otherwise chosen each time you assign it.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Frequency</label>
                <select className="input" value={tpl.frequency} onChange={(e) => set({ frequency: e.target.value })}>
                  {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Status</label>
                <select className="input" value={tpl.status} onChange={(e) => set({ status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="rounded-2xl bg-clay-surface p-3 shadow-clay-inset">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-ink-500">Recurring window (optional)</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">From</label>
                  <input type="date" className="input font-mono" value={tpl.assignedFrom}
                    onChange={(e) => set({ assignedFrom: e.target.value })} />
                </div>
                <div>
                  <label className="label">To</label>
                  <input type="date" className="input font-mono" value={tpl.assignedTo} min={tpl.assignedFrom}
                    onChange={(e) => set({ assignedTo: e.target.value })} />
                </div>
              </div>
              <p className="mt-2 text-[11px] text-ink-400">
                When set, an <strong>Active</strong> form auto-schedules on the calendar at its frequency. You can also assign one-off dates from the Forms list.
              </p>
            </div>
          </div>
        </div>

        {/* Questions */}
        <div className="card p-6 lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-ink-800">
              Questions <span className="text-ink-400">({tpl.fields.length})</span>
              {passFailCount > 0 && <span className="ml-2 text-[11px] font-normal text-ink-400">· {passFailCount} scored Pass/Fail</span>}
            </h3>
            <div className="flex gap-2">
              <button className="btn-ghost text-xs" onClick={downloadQuestionTemplate}><Download size={14} /> Template</button>
              <label className="btn-soft cursor-pointer text-xs">
                <FileUp size={14} /> Import Excel
                <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleImport} />
              </label>
            </div>
          </div>

          {tpl.fields.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-clay-300 p-8 text-center text-sm text-ink-400">
              No questions yet. Add one or import from Excel.
            </div>
          ) : (
            <div className="space-y-3">
              {tpl.fields.map((f, i) => (
                <div key={f.id} className="rounded-2xl bg-clay-surface p-3 shadow-clay-sm">
                  <div className="flex items-start gap-3">
                    <div className="mt-2 flex items-center gap-1 text-ink-300">
                      <GripVertical size={16} />
                      <span className="text-xs font-bold text-ink-400">{i + 1}</span>
                    </div>
                    <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-[1fr,150px,150px]">
                      <input className="input" placeholder="Question / check…" value={f.label}
                        onChange={(e) => updateField(f.id, { label: e.target.value })} />
                      <select className="input" value={f.type} onChange={(e) => updateField(f.id, { type: e.target.value })}>
                        {QUESTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <select className="input" value={f.photoRequirement} onChange={(e) => updateField(f.id, { photoRequirement: e.target.value })}>
                        {PHOTO_REQUIREMENTS.map((p) => <option key={p} value={p}>📷 {p}</option>)}
                      </select>
                    </div>
                    <button onClick={() => removeField(f.id)} className="mt-1 rounded-lg p-2 text-ink-400 transition hover:bg-red-50 hover:text-red-600">
                      <Trash2 size={16} />
                    </button>
                  </div>

                  {isChoice(f.type) && (
                    <div className="mt-3 ml-7 rounded-xl bg-clay-bg/60 p-3">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-ink-500">
                        Options <span className="text-ink-400">({f.type === 'Single Choice' ? 'pick one' : 'pick many'})</span>
                      </p>
                      <div className="space-y-2">
                        {fieldOptions(f).map((opt, oi) => (
                          <div key={oi} className="flex items-center gap-2">
                            <span className="text-xs font-bold text-ink-300 w-4 text-right">{oi + 1}</span>
                            <input className="input flex-1 py-2" placeholder={`Option ${oi + 1}`} value={opt}
                              onChange={(e) => updateOption(f, oi, e.target.value)} />
                            <button onClick={() => removeOption(f, oi)} className="rounded-lg p-1.5 text-ink-400 transition hover:bg-red-50 hover:text-red-600">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <button onClick={() => addOption(f)} className="btn-ghost mt-2 text-xs">
                        <Plus size={13} /> Add option
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <button onClick={addField} className="btn-ghost mt-4 w-full border border-dashed border-clay-300">
            <Plus size={16} /> Add question
          </button>
        </div>
      </div>
    </div>
  )
}
