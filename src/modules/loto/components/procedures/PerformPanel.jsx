import { useState } from 'react'
import toast from 'react-hot-toast'
import { numberIsolationPoints } from '../../utils/codes'
import { deviceLabel, pointDevicesLabel } from '../../constants/energySources'
import { LOCK_STATUS, computeLockSummary } from '../../constants/procedures'
import { lockoutDeviceTally } from '../../utils/lockout'
import {
  addGroupMember,
  removeGroupMember,
  setPointLock,
} from '../../services/procedures'
import Button from '../ui/Button'
import ApplyLockDialog from './ApplyLockDialog'
import GroupLockDialog from './GroupLockDialog'
import PointTagDialog from './PointTagDialog'

export default function PerformPanel({
  procedure,
  technicians = [],
  locks = [],
  inUseLockNos,
  user,
}) {
  const [tagFor, setTagFor] = useState(null)
  const [busyKey, setBusyKey] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingPoint, setPendingPoint] = useState(null)
  const [groupOpen, setGroupOpen] = useState(false)

  const points = numberIsolationPoints(procedure.isolationPoints || [])
  const summary = procedure.lockSummary || computeLockSummary(points)
  const fullyLocked = summary.status === LOCK_STATUS.LOCKED
  const group = procedure.groupLock || { active: false, method: null, members: [] }
  const membersRemain = Boolean(group.active && (group.members?.length || 0) > 0)
  const personalPrimaryPoints = points
    .filter((p) => p.lockState?.locked && p.lockState.lockType === 'personal')
    .map((p) => ({ key: p.key, pointId: p.pointId }))
  const tally = lockoutDeviceTally(procedure)
  const tallyEntries = Object.entries(tally).filter(([, v]) => v > 0)

  async function doLock(point, tech) {
    setBusyKey(point.key)
    try {
      await setPointLock(procedure.id, point.key, true, user, tech)
      toast.success(`${point.pointId} locked out`)
    } catch (err) {
      toast.error(err.message || 'Could not lock')
    } finally {
      setBusyKey(null)
    }
  }

  function onLock(point) {
    // Every point picks its own technician + unique lock.
    setPendingPoint(point)
    setPickerOpen(true)
  }

  function onPickTech(tech) {
    setPickerOpen(false)
    const p = pendingPoint
    setPendingPoint(null)
    if (p) doLock(p, tech)
  }

  async function onUnlock(point) {
    setBusyKey(point.key)
    try {
      await setPointLock(procedure.id, point.key, false, user)
      toast.success(`${point.pointId} unlocked`)
    } catch (err) {
      toast.error(err.message || 'Could not unlock')
    } finally {
      setBusyKey(null)
    }
  }

  async function onAddMember(member, method, swaps) {
    try {
      await addGroupMember(procedure.id, member, method, user, swaps)
      setGroupOpen(false)
      toast.success(`${member.name} added to group lock`)
    } catch (err) {
      toast.error(err.message || 'Could not add to group lock')
    }
  }

  async function onRemoveMember(techId, name) {
    try {
      await removeGroupMember(procedure.id, techId, user)
      toast(`${name} removed from group lock`, { icon: '🔓' })
    } catch (err) {
      toast.error(err.message || 'Could not remove')
    }
  }

  return (
    <div className="space-y-4">
      {/* Perform checklist */}
      <div className="overflow-hidden rounded-2xl bg-claySurface shadow-clay">
        <div className="flex items-center justify-between px-5 py-3">
          <h3 className="text-sm font-bold text-steel-50">Perform — lock out each isolation point</h3>
          <span className="text-xs font-semibold text-steel-400">
            {summary.lockedCount} / {summary.total} locked
          </span>
        </div>
        <ul className="divide-y divide-steel-700/60">
          {points.map((p) => {
            const locked = p.lockState?.locked
            return (
              <li key={p.key} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="grid h-7 w-12 shrink-0 place-items-center rounded-md text-xs font-extrabold"
                    style={{ background: p.color, color: p.textColor }}
                  >
                    {p.pointId}
                  </span>
                  <div className="min-w-0 text-sm text-steel-200">
                    {pointDevicesLabel(p)}
                    {p.rating ? <span className="ml-1 text-steel-400">· {p.rating}</span> : null}
                    {locked && p.lockState?.techName && (
                      <span className="block text-xs text-steel-400">
                        🔒 {p.lockState.techName}
                        {p.lockState.lockType
                          ? ` · ${p.lockState.lockType === 'department' ? 'Dept' : 'Personal'}`
                          : ''}
                        {p.lockState.techLockNo ? ` #${p.lockState.techLockNo}` : ''}
                      </span>
                    )}
                    {locked &&
                      group.active &&
                      group.members?.map((m) =>
                        m.locks?.[p.key] ? (
                          <span key={m.techId} className="block text-xs text-steel-400">
                            👥 {m.name} · Dept #{m.locks[p.key]}
                          </span>
                        ) : null,
                      )}
                  </div>
                </div>
                {/* Only while the lock is on. A tag exists to hang on a locked
                    point, and offering one for an unlocked point invites
                    printing a tag that claims an isolation nobody performed. */}
                {locked && (
                  <button
                    type="button"
                    onClick={() => setTagFor(p)}
                    title={`Print the tag for ${p.pointId}`}
                    aria-label={`Print the tag for ${p.pointId}`}
                    className="shrink-0 rounded-lg bg-steel-700 px-2.5 py-1.5 text-xs font-bold text-steel-100 transition-colors hover:bg-steel-600"
                  >
                    Tag
                  </button>
                )}
                <button
                  disabled={busyKey === p.key || (locked && membersRemain)}
                  title={locked && membersRemain ? 'Remove all group-lock technicians first' : undefined}
                  onClick={() => (locked ? onUnlock(p) : onLock(p))}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50 ${
                    locked
                      ? 'bg-steel-700 text-steel-100 hover:bg-steel-600'
                      : 'bg-danger text-white hover:brightness-95'
                  }`}
                >
                  {busyKey === p.key ? '…' : locked ? 'Unlock' : 'Lock out'}
                </button>
              </li>
            )
          })}
        </ul>
        {membersRemain && (
          <div className="border-t border-steel-700/60 px-5 py-2.5 text-xs text-amber-600">
            Group lock active — remove all group-lock technicians below before the primary lock can be removed.
          </div>
        )}
      </div>

      {/* Group lock — only once equipment is fully locked */}
      {fullyLocked && (
        <div className="rounded-2xl bg-claySurface p-5 shadow-clay">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-steel-50">Group Lock</h3>
              <p className="text-xs text-steel-400">
                Add other technicians to this lockout
                {group.active ? ` · ${group.method === 'box' ? 'Group LOTO Box' : 'Hasp'}` : ''}
              </p>
            </div>
            <Button size="sm" onClick={() => setGroupOpen(true)}>
              + Group Lock
            </Button>
          </div>

          {/* Members */}
          {group.active && group.members?.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {procedure.primaryTech?.name && (
                <li className="text-xs font-medium text-steel-400">
                  Lead technician: {procedure.primaryTech.name}
                </li>
              )}
              {group.members.map((mem) => (
                <li
                  key={mem.techId}
                  className="flex items-center justify-between rounded-lg bg-clay px-3 py-2 text-sm shadow-clay-inset"
                >
                  <span className="min-w-0 text-steel-100">
                    {mem.name}
                    <span className="text-steel-400">
                      {' · '}
                      {mem.boxLock
                        ? `box #${mem.boxLock}`
                        : Object.values(mem.locks || {})
                            .map((no) => `#${no}`)
                            .join(', ')}
                    </span>
                  </span>
                  <button
                    onClick={() => onRemoveMember(mem.techId, mem.name)}
                    className="shrink-0 pl-2 text-xs font-medium text-danger hover:underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Device tally */}
          {tallyEntries.length > 0 && (
            <div className="mt-4 border-t border-steel-700 pt-3">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-widest text-steel-400">
                LOTO devices in use
              </div>
              <div className="flex flex-wrap gap-2">
                {tallyEntries.map(([key, count]) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1.5 rounded-full bg-clay px-3 py-1 text-xs font-medium text-steel-200 shadow-clay-inset"
                  >
                    {deviceLabel(key)}
                    <span className="font-bold text-steel-50">×{count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <PointTagDialog procedure={procedure} point={tagFor} onClose={() => setTagFor(null)} />

      <ApplyLockDialog
        open={pickerOpen}
        technicians={technicians}
        locks={locks}
        inUseLockNos={inUseLockNos}
        forceDepartment={points.length > 1}
        onConfirm={onPickTech}
        onClose={() => {
          setPickerOpen(false)
          setPendingPoint(null)
        }}
      />
      <GroupLockDialog
        open={groupOpen}
        technicians={technicians}
        locks={locks}
        inUseLockNos={inUseLockNos}
        excludeIds={[
          procedure.primaryTech?.techId,
          ...(group.members || []).map((m) => m.techId),
        ].filter(Boolean)}
        currentMethod={group.active ? group.method : null}
        points={points}
        personalPrimaryPoints={personalPrimaryPoints}
        onConfirm={onAddMember}
        onClose={() => setGroupOpen(false)}
      />
    </div>
  )
}
