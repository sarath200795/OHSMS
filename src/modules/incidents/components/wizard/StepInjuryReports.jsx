import { HeartPulse, Stethoscope, Lock } from 'lucide-react'
import BodyMap from '../BodyMap'
import FileUploader from '../FileUploader'
import { INJURY_TYPES } from '../../lib/constants'

const personName = (p) => p.name || (p.kind === 'internal' ? 'Internal member' : 'External person')

const blank = (p) => ({
  personId: p.id,
  personName: personName(p),
  firstAidDone: false,
  firstAidDetail: '',
  bodyParts: [],
  injuryType: '',
  medication: '',
  daysToReturnToWork: '',
})

/**
 * Step 1a — per-person injury report. Shown only when the incident type warrants
 * it. `persons` = affected personnel; `value` = injuryReports[]; medical records
 * are stored as incident photos (kind 'medical_record') tagged by personId.
 */
export default function StepInjuryReports({ persons = [], value = [], onChange, photos = [], onAddPhoto, onRemovePhoto, canEdit = true, lockedPersonIds = new Set() }) {
  const reportFor = (p) => value.find((r) => r.personId === p.id) || blank(p)
  const setReport = (p, patch) => {
    const existing = value.find((r) => r.personId === p.id)
    const next = existing
      ? value.map((r) => (r.personId === p.id ? { ...r, ...patch } : r))
      : [...value, { ...blank(p), ...patch }]
    onChange(next)
  }

  if (persons.length === 0) {
    return (
      <div className="rounded-2xl bg-amber-50 p-5 text-sm text-amber-800">
        Add the affected personnel in Step 1 first — an injury report is captured for each person.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {persons.map((p) => {
        const r = reportFor(p)
        const records = photos.filter((ph) => ph.personId === p.id)
        const locked = lockedPersonIds.has(p.id)
        return (
          <div key={p.id} className="card p-5">
            <div className="mb-4 flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-500/10 text-brand-600"><HeartPulse size={18} /></div>
              <div className="flex-1">
                <h3 className="font-bold text-ink-900">{personName(p)}</h3>
                <p className="text-xs text-ink-400 capitalize">{p.kind}{p.dept ? ` · ${p.dept}` : ''}{p.company ? ` · ${p.company}` : ''}</p>
              </div>
              {locked && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700"><Lock size={12} /> Verified — locked</span>
              )}
            </div>

            <fieldset disabled={locked} className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <label className="label">First aid done?</label>
                  <div className="flex gap-2">
                    {[{ v: true, l: 'Yes' }, { v: false, l: 'No' }].map((o) => (
                      <button
                        key={o.l}
                        type="button"
                        onClick={() => setReport(p, { firstAidDone: o.v })}
                        className={`btn ${r.firstAidDone === o.v ? 'bg-brand-500 text-white shadow-clay-brand' : 'bg-clay-surface text-ink-600'}`}
                      >
                        {o.l}
                      </button>
                    ))}
                  </div>
                  {r.firstAidDone && (
                    <input className="input mt-2" placeholder="First aid details (what was done)" value={r.firstAidDetail || ''} onChange={(e) => setReport(p, { firstAidDetail: e.target.value })} />
                  )}
                </div>

                <div>
                  <label className="label">Type of injury</label>
                  <select className="input" value={r.injuryType || ''} onChange={(e) => setReport(p, { injuryType: e.target.value })}>
                    <option value="">Select injury type…</option>
                    {INJURY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Medication</label>
                    <input className="input" placeholder="If any" value={r.medication || ''} onChange={(e) => setReport(p, { medication: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Days to return to work</label>
                    <input type="number" min="0" className="input" placeholder="0" value={r.daysToReturnToWork ?? ''} onChange={(e) => setReport(p, { daysToReturnToWork: e.target.value })} />
                  </div>
                </div>

                <div>
                  <label className="label flex items-center gap-1.5"><Stethoscope size={13} /> Medical records</label>
                  <FileUploader
                    accept="any"
                    label="Attach medical record"
                    hint="Image or PDF, up to 750 KB each."
                    disabled={!canEdit}
                    files={records}
                    onAdd={(f) => onAddPhoto?.({ ...f, kind: 'medical_record', personId: p.id })}
                    onRemove={onRemovePhoto}
                  />
                </div>
              </div>

              <div>
                <label className="label">Injured body part(s)</label>
                <BodyMap value={r.bodyParts || []} onChange={(bodyParts) => setReport(p, { bodyParts })} />
              </div>
            </fieldset>
          </div>
        )
      })}
    </div>
  )
}
