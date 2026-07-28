import { useState } from 'react'

/**
 * Site (center name) picker shared by the AED / FAS forms.
 * Shows a dropdown of every existing site (which includes all fire-extinguisher
 * repository centers) so a new asset is attached to a known site; an
 * "Add a new site…" option reveals a free-text input for a brand-new site.
 *
 * Props:
 *  - value: current centerName string
 *  - sites: string[] of known sites (from useFleet().sites)
 *  - onChange(nextValue): called with the chosen/typed site
 *  - required, placeholder
 */
export default function SitePicker({ value, sites = [], onChange, required = false, placeholder = 'e.g. Tower B' }) {
  // Custom mode when a value is set that isn't one of the known sites.
  const [custom, setCustom] = useState(Boolean(value) && !sites.includes(value))

  if (custom) {
    return (
      <div className="flex gap-2">
        <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} required={required} autoFocus />
        <button type="button" className="btn-ghost shrink-0" onClick={() => { setCustom(false); onChange('') }} title="Pick from existing sites">List</button>
      </div>
    )
  }

  return (
    <select
      className="input"
      value={value}
      required={required}
      onChange={(e) => {
        if (e.target.value === '__new__') { setCustom(true); onChange('') }
        else onChange(e.target.value)
      }}
    >
      <option value="">Select a site…</option>
      {sites.map((s) => <option key={s} value={s}>{s}</option>)}
      <option value="__new__">＋ Add a new site…</option>
    </select>
  )
}
