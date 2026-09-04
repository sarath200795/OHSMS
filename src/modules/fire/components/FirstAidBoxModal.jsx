import { useEffect, useMemo, useState } from 'react'
import { Trash2, Undo2, PackageCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { Modal, Spinner, Field } from './ui'
import { FIRST_AID_ITEMS, FIRST_AID_CONDITIONS, FIRST_AID_CONDITION_COLOR } from '../lib/constants'
import { isExpired, isExpiringSoon } from '../lib/firstAidLogic'

/**
 * Check a whole first aid box in one pass.
 *
 * The register is one row per (site, box, item), and there are sixteen items —
 * so the only way to populate it a record at a time is sixteen trips through an
 * Add dialog per box. Nobody does that, and a matrix nobody fills in reads as an
 * estate with no first aid provision at all. This is the form the work actually
 * takes: open the box, go down the list, type what is in it, save once.
 *
 * Every row is written in ONE batch (see saveFirstAidBox), so a box is never
 * half-recorded — a checker who is interrupted has either saved the lot or
 * saved nothing, rather than leaving eleven of sixteen items looking surveyed.
 *
 * Props: open, onClose, site, boxLocation, records (this site's whole register),
 *        onSave(rows, removals) → Promise, busy
 */
export default function FirstAidBoxModal({ open, onClose, site, boxLocation, records, onSave, busy }) {
  const [box, setBox] = useState(boxLocation || '')
  const [rows, setRows] = useState({})
  const [removed, setRemoved] = useState(() => new Set())
  const today = useMemo(() => new Date(), [])

  // The records already in this box, by item. More than one for the same item
  // is a data-entry slip rather than a shape the form supports: the checklist
  // edits the first and says so, instead of silently overwriting the rest.
  const existing = useMemo(() => {
    const m = new Map()
    for (const r of records || []) {
      if (r.centerName !== site) continue
      if ((r.boxLocation || '') !== (box || '')) continue
      if (!m.has(r.item)) m.set(r.item, [])
      m.get(r.item).push(r)
    }
    return m
  }, [records, site, box])

  // Re-seed whenever the dialog opens or the box changes — the values on screen
  // must be what is in THIS box, not what was typed for the previous one.
  useEffect(() => {
    if (!open) return
    const seeded = {}
    for (const item of FIRST_AID_ITEMS) {
      const rec = (existing.get(item.name) || [])[0]
      seeded[item.name] = {
        id: rec?.id || '',
        quantity: rec ? String(rec.quantity ?? '') : '',
        condition: rec?.condition || 'Available',
        expiryDate: rec?.expiryDate || '',
      }
    }
    setRows(seeded)
    setRemoved(new Set())
  }, [open, existing])

  useEffect(() => { if (open) setBox(boxLocation || '') }, [open, boxLocation])

  const set = (item, field, value) => setRows((p) => ({ ...p, [item]: { ...p[item], [field]: value } }))

  const toggleRemove = (id) => setRemoved((p) => {
    const n = new Set(p)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  const submit = async () => {
    if (!site) return toast.error('No site selected')
    const toWrite = []
    for (const item of FIRST_AID_ITEMS) {
      const row = rows[item.name]
      if (!row) continue
      if (row.id && removed.has(row.id)) continue
      const qty = row.quantity === '' ? null : Number(row.quantity)
      // An untouched row with no record behind it is not an answer, and writing
      // it would turn "we did not check this" into a recorded zero. Only rows
      // the checker actually filled in — or that already exist — are written.
      if (!row.id && qty === null && row.condition === 'Available') continue
      if (qty !== null && (Number.isNaN(qty) || qty < 0)) return toast.error(`${item.name}: quantity must be 0 or more`)
      toWrite.push({
        id: row.id || undefined,
        centerName: site,
        item: item.name,
        boxLocation: box,
        quantity: qty ?? 0,
        condition: row.condition,
        expiryDate: item.expires ? row.expiryDate : '',
        lastChecked: new Date().toISOString().slice(0, 10),
      })
    }
    const removals = [...removed]
    if (!toWrite.length && !removals.length) return toast.error('Nothing to save — record at least one item')
    await onSave(toWrite, removals)
  }

  const filled = Object.values(rows).filter((r) => r.id || r.quantity !== '').length

  return (
    <Modal open={open} onClose={onClose} title={`Check first aid box — ${site || ''}`}>
      <div className="space-y-4">
        <Field label="Which box? (optional — a site may have several)">
          <input
            className="input"
            placeholder="e.g. Reception, Gym floor, Kitchen"
            value={box}
            onChange={(e) => setBox(e.target.value)}
          />
        </Field>
        <p className="rounded-xl bg-brand-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
          Enter what is actually in the box. <strong>Min</strong> is the quantity this site is expected to hold —
          across every box, not each one. Leave a row blank to say nothing was checked; enter <strong>0</strong> to
          say you looked and there were none. Saving stamps today as the check date on every row below.
        </p>

        <div className="max-h-[52vh] overflow-auto rounded-xl border border-clay-200/60">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="sticky top-0 bg-clay-100/90 text-left text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-center">Min</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">Condition</th>
                <th className="px-3 py-2">Expiry</th>
                <th className="px-3 py-2"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-clay-200/50">
              {FIRST_AID_ITEMS.map((item) => {
                const row = rows[item.name] || { quantity: '', condition: 'Available', expiryDate: '' }
                const extras = (existing.get(item.name) || []).length - 1
                const gone = row.id && removed.has(row.id)
                const stale = row.expiryDate && isExpired({ expiryDate: row.expiryDate }, today)
                const soon = row.expiryDate && isExpiringSoon({ expiryDate: row.expiryDate }, today)
                return (
                  <tr key={item.name} className={gone ? 'opacity-40' : 'hover:bg-clay-50'}>
                    <td className="px-3 py-2 font-semibold text-ink-800">
                      {item.name}
                      {extras > 0 && (
                        <span className="block text-[10px] font-normal text-amber-700" title="Manage the extras from the matrix cell">
                          {extras} more record{extras === 1 ? '' : 's'} for this item — edit from the matrix cell
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-ink-400">{item.minQty}</td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        disabled={gone}
                        className="input !py-1.5 !px-2 w-20"
                        aria-label={`Quantity of ${item.name}`}
                        placeholder="—"
                        value={row.quantity}
                        onChange={(e) => set(item.name, 'quantity', e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        disabled={gone}
                        className="input !py-1.5 !px-2"
                        aria-label={`Condition of ${item.name}`}
                        style={{ color: FIRST_AID_CONDITION_COLOR[row.condition] }}
                        value={row.condition}
                        onChange={(e) => set(item.name, 'condition', e.target.value)}
                      >
                        {FIRST_AID_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {item.expires ? (
                        <input
                          type="date"
                          disabled={gone}
                          className={`input !py-1.5 !px-2 ${stale ? 'text-red-700' : soon ? 'text-amber-700' : ''}`}
                          aria-label={`Expiry date of ${item.name}`}
                          value={row.expiryDate}
                          onChange={(e) => set(item.name, 'expiryDate', e.target.value)}
                        />
                      ) : (
                        <span className="text-xs text-ink-300">n/a</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.id ? (
                        <button
                          type="button"
                          onClick={() => toggleRemove(row.id)}
                          title={gone ? `Keep the ${item.name} record` : `Delete the ${item.name} record from this box`}
                          aria-label={gone ? `Keep the ${item.name} record` : `Delete the ${item.name} record`}
                          className={`rounded-lg p-1.5 ${gone ? 'text-ink-500 hover:bg-ink-100' : 'text-red-600 hover:bg-red-50'}`}
                        >
                          {gone ? <Undo2 size={15} /> : <Trash2 size={15} />}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-xs text-ink-500">
            {filled} of {FIRST_AID_ITEMS.length} items recorded{removed.size ? ` · ${removed.size} to delete` : ''}
          </span>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? <Spinner size={16} /> : (<><PackageCheck size={16} /> Save box check</>)}
          </button>
        </div>
      </div>
    </Modal>
  )
}
