import { describe, it, expect } from 'vitest'
import {
  allChecked, applyPermitLocks, checksFrom, emergencyProblems, releasePermitLocks, returnProblems,
  startProblems,
} from './permitLocks'

const NOW = 1_000_000
const permit = (over = {}) => ({
  id: 'LP-2026-0001', status: 'approved', windowEnd: NOW + 3_600_000, procedureRevision: 2,
  pointKeys: ['k1', 'k2'],
  locks: [
    { pointKey: 'k1', lockNo: 'D-1', lockType: 'department', techId: null, techName: '' },
    { pointKey: 'k2', lockNo: 'D-2', lockType: 'department', techId: null, techName: '' },
  ],
  ...over,
})
const proc = (over = {}) => ({
  id: 'p1', status: 'approved', revision: 2,
  isolationPoints: [{ key: 'k1', lockState: { locked: false } }, { key: 'k2' }],
  ...over,
})
const scans = { k1: { at: 1 }, k2: { at: 2 } }

describe('startProblems', () => {
  it('has nothing to say about a clean start', () => {
    expect(startProblems({ permit: permit(), procedure: proc(), scans, nowMs: NOW })).toEqual([])
  })

  it('refuses until the tag on EVERY point has been scanned', () => {
    const p = startProblems({ permit: permit(), procedure: proc(), scans: { k1: { at: 1 } }, nowMs: NOW })
    expect(p.join(' ')).toMatch(/1 still to scan/)
  })

  it('refuses a permit that is not approved, or whose window has ended', () => {
    expect(startProblems({ permit: permit({ status: 'requested' }), procedure: proc(), scans, nowMs: NOW })[0]).toMatch(/not approved/)
    expect(startProblems({ permit: permit({ windowEnd: NOW - 1 }), procedure: proc(), scans, nowMs: NOW }).join(' ')).toMatch(/window has ended/)
  })

  it('refuses a procedure that was revised, withdrawn from approval, or re-pointed', () => {
    expect(startProblems({ permit: permit(), procedure: proc({ revision: 3 }), scans, nowMs: NOW }).join(' ')).toMatch(/revised/)
    expect(startProblems({ permit: permit(), procedure: proc({ status: 'draft' }), scans, nowMs: NOW }).join(' ')).toMatch(/no longer approved/)
    expect(startProblems({ permit: permit(), procedure: proc({ isolationPoints: [{ key: 'k1' }] }), scans, nowMs: NOW }).join(' ')).toMatch(/no longer match/)
  })

  it('refuses equipment that is already held, locked, or in a group lockout', () => {
    expect(startProblems({ permit: permit(), procedure: proc({ activePermit: { id: 'LP-2026-0009', permitNo: 'LP-2026-0009' } }), scans, nowMs: NOW }).join(' ')).toMatch(/already isolated under permit LP-2026-0009/)
    expect(startProblems({ permit: permit(), procedure: proc({ isolationPoints: [{ key: 'k1', lockState: { locked: true } }, { key: 'k2' }] }), scans, nowMs: NOW }).join(' ')).toMatch(/already locked/)
    expect(startProblems({ permit: permit(), procedure: proc({ groupLock: { active: true } }), scans, nowMs: NOW }).join(' ')).toMatch(/group lockout/)
  })

  it('refuses a point with no lock, and several points on personal locks', () => {
    const noLock = permit({ locks: [{ pointKey: 'k1', lockNo: 'D-1', lockType: 'department' }, { pointKey: 'k2', lockNo: '' }] })
    expect(startProblems({ permit: noLock, procedure: proc(), scans, nowMs: NOW }).join(' ')).toMatch(/needs a lock/)
    const personal = permit({ locks: [{ pointKey: 'k1', lockNo: 'P-1', lockType: 'personal' }, { pointKey: 'k2', lockNo: 'D-2', lockType: 'department' }] })
    expect(startProblems({ permit: personal, procedure: proc(), scans, nowMs: NOW }).join(' ')).toMatch(/Department lock/)
  })

  it('lets a permit with nothing to isolate start without a procedure', () => {
    expect(startProblems({ permit: permit({ pointKeys: [], locks: [] }), procedure: null, scans: {}, nowMs: NOW })).toEqual([])
  })
})

describe('applyPermitLocks / releasePermitLocks', () => {
  const user = { id: 'u1', displayName: 'Req' }
  const p = proc({ isolationPoints: [{ key: 'k1', pointId: 'E-1' }, { key: 'k2', pointId: 'H-1' }] })

  it('locks every point from the permit’s lock plan and reports the summary', () => {
    const out = applyPermitLocks(p, permit({ locks: [
      { pointKey: 'k1', lockNo: 'D-1', lockType: 'department', techName: 'Asha', techId: 't1' },
      { pointKey: 'k2', lockNo: 'D-2', lockType: 'department' },
    ] }), { user, atIso: '2026-10-05T00:00:00.000Z' })
    expect(out.points.map((x) => x.lockState.techLockNo)).toEqual(['D-1', 'D-2'])
    expect(out.points[0].lockState).toMatchObject({ locked: true, lockedBy: 'u1', techName: 'Asha', unlockedAt: null })
    expect(out.lockSummary).toMatchObject({ total: 2, lockedCount: 2, status: 'locked' })
    expect(out.primaryTech.lockNo).toBe('D-1')
  })

  it('releases them all, keeping who locked and recording who unlocked', () => {
    const locked = applyPermitLocks(p, permit(), { user, atIso: 'a' })
    const out = releasePermitLocks({ ...p, isolationPoints: locked.points }, { user: { id: 'adm', displayName: 'Adm' }, atIso: 'b' })
    expect(out.released).toEqual(['D-1', 'D-2'])
    expect(out.points[0].lockState).toMatchObject({ locked: false, lockedBy: 'u1', unlockedBy: 'adm', unlockedAt: 'b' })
    expect(out.lockSummary).toMatchObject({ lockedCount: 0, status: 'unlocked' })
    expect(out.groupLock).toEqual({ active: false, method: null, members: [] })
  })
})

describe('returnProblems', () => {
  const ticked = { toolsRemoved: true, guardsReplaced: true, personnelClear: true, affectedNotified: true }
  const active = permit({ status: 'active' })
  const held = proc({ activePermit: { id: 'LP-2026-0001' } })

  it('passes with the whole checklist and every lock confirmed', () => {
    expect(returnProblems({ permit: active, procedure: held, ticked, confirmed: ['k1', 'k2'] })).toEqual([])
  })

  it('needs every checklist item, and every lock individually confirmed', () => {
    expect(returnProblems({ permit: active, procedure: held, ticked: { ...ticked, guardsReplaced: false }, confirmed: ['k1', 'k2'] }).join(' ')).toMatch(/checklist/)
    expect(returnProblems({ permit: active, procedure: held, ticked, confirmed: ['k1'] }).join(' ')).toMatch(/1 still to confirm/)
  })

  it('refuses when the equipment is held by a different permit', () => {
    expect(returnProblems({ permit: active, procedure: proc({ activePermit: { id: 'LP-2026-0005' } }), ticked, confirmed: ['k1', 'k2'] }).join(' ')).toMatch(/not held by this permit/)
  })

  it('refuses a permit that is not active', () => {
    expect(returnProblems({ permit: permit({ status: 'returned' }), procedure: held, ticked, confirmed: ['k1', 'k2'] })[0]).toMatch(/not active/)
  })
})

describe('emergencyProblems', () => {
  const active = permit({ status: 'active' })
  const held = proc({ activePermit: { id: 'LP-2026-0001' } })
  const attest = { ownerUnavailable: true, equipmentInspected: true, ownerWillBeTold: true }

  it('needs a reason and all three attestations', () => {
    expect(emergencyProblems({ permit: active, procedure: held, reason: 'Owner off site, line must clear', attest })).toEqual([])
    expect(emergencyProblems({ permit: active, procedure: held, reason: 'short', attest }).join(' ')).toMatch(/reason/)
    expect(emergencyProblems({ permit: active, procedure: held, reason: 'A long enough reason', attest: { ...attest, ownerWillBeTold: false } }).join(' ')).toMatch(/attestation/)
  })
})

describe('checklist helpers', () => {
  it('builds the booleans the rules expect', () => {
    expect(checksFrom({ toolsRemoved: true })).toEqual({ toolsRemoved: true, guardsReplaced: false, personnelClear: false, affectedNotified: false })
    expect(allChecked({ toolsRemoved: true })).toBe(false)
  })
})
