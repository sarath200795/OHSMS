import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Modal from '../ui/Modal'
import Button from '../ui/Button'

const fieldCls =
  'w-full rounded-xl bg-clay px-3.5 py-2.5 text-steel-100 shadow-clay-inset outline-none ring-2 ring-transparent focus:ring-hazard/50'

/**
 * Apply-lock dialog. Two modes:
 *  - Single isolation point (!forceDepartment): pick a technician; the lock is
 *    that technician's own dedicated lock no. (Personal). Technicians whose
 *    dedicated lock is already in use are hidden.
 *  - Multi-point (forceDepartment): pick a technician + a unique Department lock
 *    from the Lock Inventory (in-use locks excluded). The lock determines type.
 * Each isolation point gets its own unique lock number.
 */
export default function ApplyLockDialog({
  open,
  technicians = [],
  locks = [],
  inUseLockNos,
  forceDepartment = false,
  onConfirm,
  onClose,
}) {
  const [techId, setTechId] = useState('')
  const [lockId, setLockId] = useState('')
  const [busy, setBusy] = useState(false)

  const inUse = inUseLockNos || new Set()

  // Single-point personal locking: only techs with a free dedicated lock.
  const personalTechs = technicians.filter(
    (t) => t.active !== false && t.lockNo && !inUse.has(t.lockNo),
  )
  // Multi-point: any active technician may apply a department lock.
  const deptTechs = technicians.filter((t) => t.active !== false)
  const techList = forceDepartment ? deptTechs : personalTechs

  const availableDeptLocks = locks.filter(
    (l) => l.active !== false && l.type === 'department' && !inUse.has(l.lockNo),
  )

  const selectedTech = techList.find((t) => t.id === techId)
  const selectedLock = availableDeptLocks.find((l) => l.id === lockId)
  const canConfirm = forceDepartment
    ? Boolean(selectedTech && selectedLock)
    : Boolean(selectedTech)

  useEffect(() => {
    if (open) {
      setTechId('')
      setLockId('')
      setBusy(false)
    }
  }, [open])

  async function confirm() {
    if (!canConfirm) return
    setBusy(true)
    try {
      if (forceDepartment) {
        await onConfirm({
          techId: selectedTech.id,
          name: selectedTech.name,
          lockNo: selectedLock.lockNo,
          lockType: 'department',
        })
      } else {
        await onConfirm({
          techId: selectedTech.id,
          name: selectedTech.name,
          lockNo: selectedTech.lockNo,
          lockType: 'personal',
        })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Apply lock"
      subtitle={
        forceDepartment
          ? 'Assign the technician and a unique Department lock for this point.'
          : "Assign the technician — their personal lock no. is applied."
      }
    >
      {techList.length === 0 ? (
        <p className="text-sm text-steel-400">
          {forceDepartment
            ? 'No authorized technicians yet. '
            : 'No technicians with an available personal lock. '}
          Manage them in the{' '}
          <Link to="/loto/technicians" className="font-semibold text-amber-600">
            Technicians
          </Link>{' '}
          tab.
        </p>
      ) : (
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-steel-200">Technician</span>
            <select value={techId} onChange={(e) => setTechId(e.target.value)} className={fieldCls}>
              <option value="">Select technician…</option>
              {techList.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {!forceDepartment && t.lockNo ? ` · #${t.lockNo}` : ''}
                </option>
              ))}
            </select>
          </label>

          {!forceDepartment && selectedTech && (
            <p className="rounded-xl bg-clay px-3.5 py-2.5 text-sm text-steel-300 shadow-clay-inset">
              Personal lock applied:{' '}
              <span className="font-mono font-bold text-steel-100">#{selectedTech.lockNo}</span>
            </p>
          )}

          {forceDepartment && (
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-steel-200">
                Department lock <span className="text-amber-600">(unique per point)</span>
              </span>
              {availableDeptLocks.length === 0 ? (
                <p className="rounded-xl bg-clay px-3.5 py-2.5 text-sm text-steel-400 shadow-clay-inset">
                  No Department locks available — all in use or none added. Manage in{' '}
                  <Link to="/loto/locks" className="font-semibold text-amber-600">
                    Lock Inventory
                  </Link>
                  .
                </p>
              ) : (
                <select
                  value={lockId}
                  onChange={(e) => setLockId(e.target.value)}
                  className={`${fieldCls} font-mono`}
                >
                  <option value="">Select lock…</option>
                  {availableDeptLocks.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.lockNo}
                    </option>
                  ))}
                </select>
              )}
            </label>
          )}

          {forceDepartment && (
            <p className="text-xs text-amber-600">
              This equipment has multiple isolation points — each point needs its own unique
              Department lock.
            </p>
          )}

          <div className="flex gap-2">
            <Button className="flex-1" loading={busy} disabled={!canConfirm} onClick={confirm}>
              Apply lock
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
