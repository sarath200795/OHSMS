import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Modal from '../ui/Modal'
import Button from '../ui/Button'

const fieldCls =
  'w-full rounded-xl bg-clay px-3.5 py-2.5 font-mono text-steel-100 shadow-clay-inset outline-none ring-2 ring-transparent focus:ring-hazard/50'
const plainCls =
  'w-full rounded-xl bg-clay px-3.5 py-2.5 text-steel-100 shadow-clay-inset outline-none ring-2 ring-transparent focus:ring-hazard/50'

/**
 * Add a technician to a group lockout. Two methods:
 *  - Group LOTO Box: the technician applies ONE lock to the box — choose their
 *    personal lock OR any available Department lock.
 *  - Hasp: the technician applies a unique Department lock to EVERY point.
 * Any personal primary lock (single point) is first swapped to a Department lock.
 * Selections are tracked by lock number and kept unique within the dialog.
 */
export default function GroupLockDialog({
  open,
  technicians = [],
  locks = [],
  inUseLockNos,
  excludeIds = [],
  currentMethod = null,
  points = [],
  personalPrimaryPoints = [],
  onConfirm,
  onClose,
}) {
  const [techId, setTechId] = useState('')
  const [method, setMethod] = useState(currentMethod || 'box')
  const [swapNos, setSwapNos] = useState({}) // { [pointKey]: lockNo }
  const [pointNos, setPointNos] = useState({}) // hasp: { [pointKey]: lockNo }
  const [boxNo, setBoxNo] = useState('') // box: single lockNo
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setTechId('')
      setMethod(currentMethod || 'box')
      setSwapNos({})
      setPointNos({})
      setBoxNo('')
      setBusy(false)
    }
  }, [open, currentMethod])

  const inUse = inUseLockNos || new Set()
  const isBox = method === 'box'
  const list = technicians.filter((t) => t.active !== false && !excludeIds.includes(t.id))
  const selectedTech = list.find((t) => t.id === techId)

  const availableDeptLocks = useMemo(
    () => locks.filter((l) => l.active !== false && l.type === 'department' && !inUse.has(l.lockNo)),
    [locks, inUse],
  )
  const methodLocked = !!currentMethod
  const needsSwap = personalPrimaryPoints.length > 0 && !currentMethod

  // All lock numbers chosen across the dialog (for local uniqueness).
  const chosen = useMemo(() => {
    const arr = [...Object.values(swapNos)]
    if (isBox) arr.push(boxNo)
    else arr.push(...Object.values(pointNos))
    return new Set(arr.filter(Boolean))
  }, [swapNos, pointNos, boxNo, isBox])

  // Department options for a select, excluding numbers chosen elsewhere.
  const deptOptions = (currentNo) =>
    availableDeptLocks.filter((l) => l.lockNo === currentNo || !chosen.has(l.lockNo))

  // Box: the technician's personal lock (if free) plus department locks.
  const boxOptions = useMemo(() => {
    const opts = []
    const pno = selectedTech?.lockNo
    if (pno && !inUse.has(pno) && (boxNo === pno || !chosen.has(pno))) {
      opts.push({ no: pno, label: `#${pno} · Personal (${selectedTech.name})` })
    }
    deptOptions(boxNo).forEach((l) => opts.push({ no: l.lockNo, label: `#${l.lockNo} · Department` }))
    return opts
  }, [selectedTech, inUse, boxNo, chosen, availableDeptLocks])

  const allSwaps = !needsSwap || personalPrimaryPoints.every((p) => swapNos[p.key])
  const allPoints = isBox ? Boolean(boxNo) : points.every((p) => pointNos[p.key])
  const canConfirm = Boolean(selectedTech) && allSwaps && allPoints

  async function confirm() {
    if (!selectedTech || !canConfirm) return
    const swapsMap = {}
    if (needsSwap) personalPrimaryPoints.forEach((p) => (swapsMap[p.key] = swapNos[p.key]))
    const member = isBox
      ? { techId: selectedTech.id, name: selectedTech.name, boxLock: boxNo }
      : { techId: selectedTech.id, name: selectedTech.name, locks: { ...pointNos } }
    setBusy(true)
    try {
      await onConfirm(member, method, swapsMap)
    } finally {
      setBusy(false)
    }
  }

  const noDeptLocks = availableDeptLocks.length === 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add to group lock"
      subtitle={
        isBox
          ? 'Each technician applies one lock to the group LOTO box.'
          : 'Each technician applies a unique Department lock to every isolation point.'
      }
    >
      <div className="space-y-4">
        {/* Method */}
        <div>
          <span className="mb-1.5 block text-sm font-medium text-steel-200">
            Method {methodLocked && <span className="text-steel-400">(set for this lockout)</span>}
          </span>
          <div className="grid grid-cols-2 gap-2">
            {[
              { k: 'box', label: 'Group LOTO Box' },
              { k: 'hasp', label: 'Hasp' },
            ].map((opt) => (
              <button
                key={opt.k}
                type="button"
                disabled={methodLocked && method !== opt.k}
                onClick={() => setMethod(opt.k)}
                className={`rounded-xl px-3 py-2 text-sm font-semibold transition-all disabled:opacity-40 ${
                  method === opt.k
                    ? 'bg-hazard text-ink shadow-clay'
                    : 'bg-clay text-steel-300 shadow-clay-inset'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Personal → department swap (single-point) */}
        {needsSwap && (
          <div className="rounded-xl border border-amber-300 bg-amber-100/60 p-3">
            <p className="mb-2 text-xs font-medium text-amber-800">
              Group lockout requires a <strong>Department lock</strong> on the equipment.
              Remove the personal lock and apply a Department lock.
            </p>
            {personalPrimaryPoints.map((p) => (
              <label key={p.key} className="mb-2 block last:mb-0">
                <span className="mb-1 block text-xs font-medium text-steel-200">
                  Replace {p.pointId} personal lock
                </span>
                {noDeptLocks ? (
                  <p className="rounded-xl bg-clay px-3 py-2 text-xs text-steel-400 shadow-clay-inset">
                    No Department locks available —{' '}
                    <Link to="/loto/locks" className="font-semibold text-amber-600">
                      Lock Inventory
                    </Link>
                    .
                  </p>
                ) : (
                  <select
                    value={swapNos[p.key] || ''}
                    onChange={(e) => setSwapNos((s) => ({ ...s, [p.key]: e.target.value }))}
                    className={fieldCls}
                  >
                    <option value="">Select department lock…</option>
                    {deptOptions(swapNos[p.key]).map((l) => (
                      <option key={l.lockNo} value={l.lockNo}>
                        {l.lockNo}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            ))}
          </div>
        )}

        {/* Technician */}
        {list.length === 0 ? (
          <p className="text-sm text-steel-400">
            No more technicians available. Add them in the{' '}
            <Link to="/loto/technicians" className="font-semibold text-amber-600">
              Technicians
            </Link>{' '}
            tab.
          </p>
        ) : (
          <>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-steel-200">Technician</span>
              <select value={techId} onChange={(e) => setTechId(e.target.value)} className={plainCls}>
                <option value="">Select technician…</option>
                {list.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.lockNo ? ` · #${t.lockNo}` : ''}
                  </option>
                ))}
              </select>
            </label>

            {/* Box: one lock (personal or department) */}
            {isBox && selectedTech && (
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-steel-200">
                  Lock for the box <span className="text-steel-400">(personal or department)</span>
                </span>
                {boxOptions.length === 0 ? (
                  <p className="rounded-xl bg-clay px-3.5 py-2.5 text-sm text-steel-400 shadow-clay-inset">
                    No locks available — free up a lock or add Department locks in{' '}
                    <Link to="/loto/locks" className="font-semibold text-amber-600">
                      Lock Inventory
                    </Link>
                    .
                  </p>
                ) : (
                  <select value={boxNo} onChange={(e) => setBoxNo(e.target.value)} className={fieldCls}>
                    <option value="">Select lock…</option>
                    {boxOptions.map((o) => (
                      <option key={o.no} value={o.no}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            )}

            {/* Hasp: one unique department lock per point */}
            {!isBox && (
              <div>
                <span className="mb-1.5 block text-sm font-medium text-steel-200">
                  Department lock per point
                </span>
                {noDeptLocks ? (
                  <p className="rounded-xl bg-clay px-3.5 py-2.5 text-sm text-steel-400 shadow-clay-inset">
                    No Department locks available —{' '}
                    <Link to="/loto/locks" className="font-semibold text-amber-600">
                      Lock Inventory
                    </Link>
                    .
                  </p>
                ) : (
                  <div className="space-y-2">
                    {points.map((p) => (
                      <div key={p.key} className="flex items-center gap-2">
                        <span
                          className="grid h-7 w-12 shrink-0 place-items-center rounded-md text-xs font-extrabold"
                          style={{ background: p.color, color: p.textColor }}
                        >
                          {p.pointId}
                        </span>
                        <select
                          value={pointNos[p.key] || ''}
                          onChange={(e) => setPointNos((s) => ({ ...s, [p.key]: e.target.value }))}
                          className={fieldCls}
                        >
                          <option value="">Select lock…</option>
                          {deptOptions(pointNos[p.key]).map((l) => (
                            <option key={l.lockNo} value={l.lockNo}>
                              {l.lockNo}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button className="flex-1" loading={busy} disabled={!canConfirm} onClick={confirm}>
                Add to group lock
              </Button>
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
