import { HeartPulse, Stethoscope, Lock, EyeOff } from 'lucide-react'
import BodyMap from '../BodyMap'
import FileUploader from '../FileUploader'
import { INJURY_TYPES } from '../../lib/constants'
import { Field } from '../ui'

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
 * it. `persons` = affected personnel; `value` = the form's working copy, which is
 * saved to /injuries; medical records are stored as incident photos (kind
 * 'medical_record').
 *
 * `hiddenPersonIds` are people whose injury is already on file but whose detail
 * this user cannot read — the fields below live in /injuries, which is gated to
 * admin and manager. They get a statement that a record exists rather than an
 * empty form, because an empty form here does not mean "no injury": it means
 * "not shown to you", and saving it would write that blank over the record.
 */
export default function StepInjuryReports({ persons = [], value = [], onChange, photos = [], onAddPhoto, onRemovePhoto, canEdit = true, lockedPersonIds = new Set(), hiddenPersonIds = new Set() }) {
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
        const hidden = hiddenPersonIds.has(p.id)
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

            {hidden ? (
              <div className="flex items-start gap-3 rounded-xl bg-clay-100 p-4 text-sm text-ink-600">
                <EyeOff size={16} className="mt-0.5 flex-none text-ink-400" />
                <p>
                  <b className="text-ink-900">An injury report is on file for this person.</b> Its detail —
                  injury type, body parts, medication, first aid and days to return to work — is part of their
                  medical record and is available to admins and managers only. It has not been lost, and it is
                  not blank: it is not shown to you.
                </p>
              </div>
            ) : (
              <fieldset disabled={locked} className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-4">
                  <div>
                    <span className="label">First aid done?</span>
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

                  <Field label="Type of injury">
                    <select className="input" value={r.injuryType || ''} onChange={(e) => setReport(p, { injuryType: e.target.value })}>
                      <option value="">Select injury type…</option>
                      {INJURY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Medication">
                      <input className="input" placeholder="If any" value={r.medication || ''} onChange={(e) => setReport(p, { medication: e.target.value })} />
                    </Field>
                    <Field label="Days to return to work">
                      <input type="number" min="0" className="input" placeholder="0" value={r.daysToReturnToWork ?? ''} onChange={(e) => setReport(p, { daysToReturnToWork: e.target.value })} />
                    </Field>
                  </div>

                  <div>
                    {/* Not covered by the injury/incident split. These files are
                        written to incidents/{id}/photos, which the generic rule
                        leaves readable by every approved member and the auditor —
                        a medical record is a file here, and moving files needs a
                        rule this change cannot make. Tracked, not fixed. */}
                    {/* A heading: FileUploader is a drop zone plus a file list, not one control. */}
        <span className="label flex items-center gap-1.5"><Stethoscope size={13} /> Medical records</span>
                    <FileUploader
                      accept="any"
                      label="Attach medical record"
                      hint="Image or PDF, up to 10 MB each."
                      disabled={!canEdit}
                      files={records}
                      onAdd={(f) => onAddPhoto?.({ ...f, kind: 'medical_record', personId: p.id })}
                      onRemove={onRemovePhoto}
                    />
                  </div>
                </div>

                <Field label="Injured body part(s)">
                  <BodyMap value={r.bodyParts || []} onChange={(bodyParts) => setReport(p, { bodyParts })} />
                </Field>
              </fieldset>
            )}
          </div>
        )
      })}
    </div>
  )
}
