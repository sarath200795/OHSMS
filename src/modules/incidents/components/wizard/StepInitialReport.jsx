import { Calendar, Clock, MapPin, AlertTriangle, Tag, Layers, FileText, Users, Lightbulb, Building2 } from 'lucide-react'
import PersonEditor from '../PersonEditor'
import { INCIDENT_TYPES, SEVERITY, HSE_CATEGORIES, LOCATIONS } from '../../lib/constants'
import SiteScopePicker from '../../../../shared/org/SiteScopePicker'

function FieldLabel({ icon: Icon, children }) {
  return <label className="label flex items-center gap-1.5"><Icon size={13} /> {children}</label>
}

/** Step 1 — Initial Incident Report form. `value`/`onChange` controlled by the wizard. */
export default function StepInitialReport({ value, onChange, users, sites = [], locations, readOnly = false }) {
  const set = (patch) => onChange({ ...value, ...patch })
  // Org-configured locations (Org Settings) drive the dropdown; fall back to the
  // built-in list if the org hasn't set any yet.
  const locationList = locations && locations.length ? locations : LOCATIONS
  return (
    <fieldset disabled={readOnly} className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel icon={Calendar}>Date of incident</FieldLabel>
          <input type="date" className="input" value={value.incidentDate || ''} onChange={(e) => set({ incidentDate: e.target.value })} />
        </div>
        <div>
          <FieldLabel icon={Clock}>Time of incident</FieldLabel>
          <input type="time" className="input" value={value.incidentTime || ''} onChange={(e) => set({ incidentTime: e.target.value })} />
        </div>
        <div>
          <FieldLabel icon={Tag}>Incident type</FieldLabel>
          <select className="input" value={value.type || ''} onChange={(e) => set({ type: e.target.value })}>
            <option value="">Select type…</option>
            {INCIDENT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel icon={AlertTriangle}>Severity (level)</FieldLabel>
          <select className="input" value={value.severity || ''} onChange={(e) => set({ severity: e.target.value })}>
            <option value="">Select severity…</option>
            {SEVERITY.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel icon={Layers}>HSE category</FieldLabel>
          <select className="input" value={value.category || ''} onChange={(e) => set({ category: e.target.value })}>
            <option value="">Select category…</option>
            {HSE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <FieldLabel icon={Building2}>Site scope</FieldLabel>
          <SiteScopePicker module="incidents" sites={sites} value={value} onChange={set} disabled={readOnly} />
          {sites.length === 0 && (
            <p className="mt-1 text-xs text-amber-600">
              You don&apos;t have site access yet — request it from your account menu.
            </p>
          )}
        </div>
        <div>
          <FieldLabel icon={MapPin}>Location / area</FieldLabel>
          <select className="input" value={value.location || ''} onChange={(e) => set({ location: e.target.value })}>
            <option value="">Select area…</option>
            {locationList.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
      </div>

      <div>
        <FieldLabel icon={FileText}>Detailed incident narrative</FieldLabel>
        <textarea
          className="input min-h-[140px] resize-y"
          maxLength={5000}
          placeholder="Describe what happened, the sequence of events, conditions and immediate actions taken…"
          value={value.narrative || ''}
          onChange={(e) => set({ narrative: e.target.value })}
        />
        <p className="mt-1 text-right text-xs text-ink-400">{(value.narrative || '').length}/5000</p>
      </div>

      <div>
        <FieldLabel icon={Lightbulb}>Probable cause</FieldLabel>
        <textarea
          className="input min-h-[90px] resize-y"
          maxLength={2000}
          placeholder="Initial assessment of the most likely cause(s) — to be confirmed during investigation…"
          value={value.probableCause || ''}
          onChange={(e) => set({ probableCause: e.target.value })}
        />
        <p className="mt-1 text-right text-xs text-ink-400">{(value.probableCause || '').length}/2000</p>
      </div>

      <div>
        <FieldLabel icon={Users}>Affected personnel</FieldLabel>
        <p className="mb-2 text-xs text-ink-400">Add everyone involved — internal staff or external parties.</p>
        <PersonEditor value={value.affectedPersonnel || []} onChange={(affectedPersonnel) => set({ affectedPersonnel })} users={users} />
      </div>
    </fieldset>
  )
}
