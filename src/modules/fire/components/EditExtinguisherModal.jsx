import { useEffect, useState } from 'react'
import { Save, Hash } from 'lucide-react'
import toast from 'react-hot-toast'
import { Modal, Spinner } from './ui'
import { updateExtinguisher } from '../lib/firestore'
import { TYPES, CAPACITIES, ENTITIES, REGIONS } from '../lib/constants'

function Field({ label, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}

/**
 * Edit an existing extinguisher's spec/dates. Serial No is read-only (it's the
 * CSV-match identity). Saving reuses updateExtinguisher, which also rewrites the
 * public QR mirror.
 *
 * Props: open, onClose, ext, orgId, orgName
 */
export default function EditExtinguisherModal({ open, onClose, ext, orgId, orgName, actor }) {
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (ext) {
      setForm({
        type: ext.type || TYPES[0],
        capacity: ext.capacity || CAPACITIES[0],
        entity: ext.entity || ENTITIES[0],
        region: ext.region || REGIONS[0],
        centerName: ext.centerName || '',
        dateOfDeployment: ext.dateOfDeployment || '',
        dateOfNextRefill: ext.dateOfNextRefill || '',
        dateOfNextHPT: ext.dateOfNextHPT || '',
      })
    }
  }, [ext])

  if (!ext || !form) return null
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const save = async () => {
    if (!form.centerName.trim()) return toast.error('Center name is required')
    setBusy(true)
    try {
      await updateExtinguisher(orgId, orgName, ext.id, form, { actor })
      toast.success('Extinguisher updated')
      onClose?.()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit extinguisher" maxWidth="max-w-2xl">
      <div className="mb-4">
        <label className="label">Serial No (read-only)</label>
        <div className="relative">
          <Hash size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="input pl-9 text-ink-500" value={ext.serialNo || '—'} readOnly disabled />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type">
          <select className="input" value={form.type} onChange={set('type')}>
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Capacity">
          <select className="input" value={form.capacity} onChange={set('capacity')}>
            {CAPACITIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Entity">
          <select className="input" value={form.entity} onChange={set('entity')}>
            {ENTITIES.map((en) => <option key={en}>{en}</option>)}
          </select>
        </Field>
        <Field label="Region">
          <select className="input" value={form.region} onChange={set('region')}>
            {REGIONS.map((rg) => <option key={rg}>{rg}</option>)}
          </select>
        </Field>
        <Field label="Center Name *">
          <input className="input" value={form.centerName} onChange={set('centerName')} required />
        </Field>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field label="Date of Deployment">
          <input type="date" className="input" value={form.dateOfDeployment} onChange={set('dateOfDeployment')} />
        </Field>
        <Field label="Date of Next Refill">
          <input type="date" className="input" value={form.dateOfNextRefill} onChange={set('dateOfNextRefill')} />
        </Field>
        <Field label="Date of Next HPT">
          <input type="date" className="input" value={form.dateOfNextHPT} onChange={set('dateOfNextHPT')} />
        </Field>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={busy}>
          {busy ? <Spinner size={18} /> : (<><Save size={16} /> Save changes</>)}
        </button>
      </div>
    </Modal>
  )
}
