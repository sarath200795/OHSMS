import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Network, Save, Loader2, RefreshCw, Image, Plus, X, Trash2 } from 'lucide-react'
import DiagramCanvas from '../diagram/DiagramCanvas'
import { METHODS } from '../../lib/diagramMethods'
import { exportDiagramPng } from '../../lib/diagramExport'
import { INVESTIGATION_METHODS } from '../../lib/constants'
import { incidentInvestigations } from '../../lib/incidents'

const rid = () => (crypto?.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10))
const labelOf = (key) => INVESTIGATION_METHODS.find((m) => m.key === key)?.label || key

/**
 * Step 3 — Investigation. Supports MULTIPLE investigation methods per incident:
 * add as many as needed, switch between them via tabs, change a method (full
 * picker), and Save (serializes every diagram + re-exports a PNG for the active
 * one). `onPersist(investigationsArray, { activeId, png })` is provided by the wizard.
 */
export default function StepInvestigation({ incident, onPersist, saving }) {
  const [list, setList] = useState(() => incidentInvestigations(incident).map((e) => ({ ...e, id: e.id || `inv_${rid()}` })))
  const [activeId, setActiveId] = useState(() => incidentInvestigations(incident)[0]?.id || null)
  const [picking, setPicking] = useState(() => incidentInvestigations(incident).length === 0)
  const [changingId, setChangingId] = useState(null) // entry whose method is being changed
  const flowRef = useRef(null)
  const latest = useRef({ nodes: [], edges: [] })

  const active = list.find((e) => e.id === activeId) || null

  // Fold the active canvas's latest graph back into the list before navigating away.
  const commitActive = (arr) =>
    arr.map((e) => (e.id === activeId && latest.current ? { ...e, diagram: { version: 1, ...latest.current } } : e))

  const selectEntry = (id) => {
    setList((arr) => commitActive(arr))
    setActiveId(id)
    setPicking(false)
    setChangingId(null)
  }

  const startAdd = () => {
    setList((arr) => commitActive(arr))
    setChangingId(null)
    setPicking(true)
  }

  const startChange = () => {
    setChangingId(activeId)
    setPicking(true)
  }

  const pickMethod = (key) => {
    if (changingId) {
      if (!window.confirm('Changing the method will replace this diagram with a fresh template. Continue?')) return
      setList((arr) => arr.map((e) => (e.id === changingId
        ? { ...e, method: key, diagram: { version: 1, ...METHODS[key].makeTemplate(incident) }, pngPhotoId: null }
        : e)))
      setActiveId(changingId)
      setChangingId(null)
      setPicking(false)
    } else {
      const entry = { id: `inv_${rid()}`, method: key, diagram: { version: 1, ...METHODS[key].makeTemplate(incident) }, summary: '', pngPhotoId: null }
      setList((arr) => [...commitActive(arr), entry])
      setActiveId(entry.id)
      setPicking(false)
    }
  }

  const removeEntry = (id) => {
    if (!window.confirm('Remove this investigation method?')) return
    setList((arr) => {
      const next = arr.filter((e) => e.id !== id)
      if (activeId === id) setActiveId(next[0]?.id || null)
      if (next.length === 0) setPicking(true)
      return next
    })
  }

  const setActiveSummary = (summary) =>
    setList((arr) => arr.map((e) => (e.id === activeId ? { ...e, summary } : e)))

  const save = async () => {
    const next = commitActive(list)
    if (active) {
      const cur = next.find((e) => e.id === activeId)
      const check = METHODS[active.method].validate(cur.diagram.nodes, cur.diagram.edges)
      if (!check.ok) toast(check.message, { icon: '⚠️' })
    }
    let png = null
    if (active) {
      try { png = await exportDiagramPng(flowRef.current) } catch { toast.error('Could not capture diagram image; saving data only.') }
    }
    setList(next)
    await onPersist(next, { activeId, png })
  }

  // Method picker (shown initially, on "Add method", and on "Change method").
  const Picker = (
    <div className="card p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-500/10 text-brand-600"><Network size={18} /></div>
          <div>
            <h3 className="font-bold text-ink-900">{changingId ? 'Change investigation method' : 'Choose an investigation method'}</h3>
            <p className="text-xs text-ink-400">Build the analysis as an interactive diagram. You can add more than one method.</p>
          </div>
        </div>
        {list.length > 0 && (
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => { setPicking(false); setChangingId(null) }}><X size={13} /> Cancel</button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {INVESTIGATION_METHODS.map((m) => (
          <button key={m.key} onClick={() => pickMethod(m.key)} className="card p-4 text-left transition hover:-translate-y-0.5 hover:shadow-glow">
            <p className="font-bold text-ink-900">{m.label}</p>
            <p className="mt-1 text-xs text-ink-500">{m.desc}</p>
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Tabs for each added investigation method */}
      {list.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {list.map((e) => (
            <div key={e.id} className={`flex items-center gap-1 rounded-xl border px-1 ${e.id === activeId && !picking ? 'border-brand-500 bg-brand-500/10' : 'border-clay-300 bg-white'}`}>
              <button className="py-1.5 pl-2 pr-1 text-xs font-semibold text-ink-700" onClick={() => selectEntry(e.id)}>{labelOf(e.method)}</button>
              <button className="grid h-5 w-5 place-items-center rounded text-ink-400 hover:bg-red-50 hover:text-red-500" onClick={() => removeEntry(e.id)} title="Remove"><Trash2 size={11} /></button>
            </div>
          ))}
          <button className="btn-soft px-3 py-1.5 text-xs" onClick={startAdd}><Plus size={13} /> Add method</button>
        </div>
      )}

      {picking ? Picker : active ? (
        <>
          <div className="card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-bold text-ink-900"><Network size={18} className="text-brand-600" /> {labelOf(active.method)}</h3>
              <button className="btn-ghost px-3 py-1.5 text-xs" onClick={startChange}><RefreshCw size={13} /> Change method</button>
            </div>
            <DiagramCanvas
              key={active.id}
              method={active.method}
              initial={active.diagram?.nodes?.length ? active.diagram : METHODS[active.method].makeTemplate(incident)}
              flowRef={flowRef}
              onChange={(g) => { latest.current = g }}
            />
          </div>

          <div className="card p-5">
            <label className="label">Investigation summary / findings</label>
            <textarea className="input min-h-[90px] resize-y" placeholder="Summarize the root cause(s) and key findings…" value={active.summary || ''} onChange={(e) => setActiveSummary(e.target.value)} />
          </div>

          <div className="flex justify-end">
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <><Image size={16} /> <Save size={16} /></>} Save investigation{list.length > 1 ? 's' : ''}
            </button>
          </div>
        </>
      ) : Picker}
    </div>
  )
}
