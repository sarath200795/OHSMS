import { describe, it, expect } from 'vitest'
import {
  equipmentKey, equipmentOptions, approvedProceduresFor, snapshotProcedure,
  lockChoices, validateDraft, buildPermit,
} from './permitModel'

const proc = (over = {}) => ({
  id: 'p1', procedureCode: 'ORG-S1-PUMP', revision: 2, equipment: 'Pump A', site: 'Site 1', siteId: 's1',
  region: 'South', entity: 'Ent', status: 'approved',
  isolationPoints: [
    { key: 'k1', energySource: 'electrical', devices: ['safety_padlock', 'hasp'] },
    { key: 'k2', energySource: 'hydraulic', devices: ['ball_valve_lock', 'safety_padlock'] },
  ],
  ...over,
})

describe('equipment and the procedure dropdown', () => {
  const all = [
    proc(),
    proc({ id: 'p2', procedureCode: 'ORG-S1-PUMP-B', status: 'draft' }),
    proc({ id: 'p3', procedureCode: 'ORG-S1-PUMP-C', status: 'pending_approval' }),
    proc({ id: 'p4', procedureCode: 'ORG-S1-PUMP-D', status: 'rejected' }),
    proc({ id: 'p5', equipment: 'Press 4', status: 'draft', procedureCode: 'ORG-S1-PRESS' }),
    proc({ id: 'p6', equipment: 'Pump A', site: 'Site 2', siteId: 's2', procedureCode: 'ORG-S2-PUMP' }),
  ]

  it('lists ONLY the approved procedures of the chosen equipment', () => {
    const list = approvedProceduresFor(all, equipmentKey(all[0]))
    expect(list.map((p) => p.id)).toEqual(['p1'])
  })

  it('does not cross sites for the same equipment name', () => {
    expect(approvedProceduresFor(all, equipmentKey(all[5])).map((p) => p.id)).toEqual(['p6'])
  })

  it('lists equipment with no approved procedure but marks it unusable', () => {
    const opts = equipmentOptions(all)
    const press = opts.find((o) => o.equipment === 'Press 4')
    expect(press.approved).toBe(0)
    expect(press.total).toBe(1)
    expect(opts.find((o) => o.equipment === 'Pump A' && o.siteId === 's1').approved).toBe(1)
  })

  it('ignores a procedure with no equipment name', () => {
    expect(equipmentOptions([proc({ equipment: '  ' })])).toEqual([])
  })
})

describe('snapshotProcedure', () => {
  it('auto-fills the devices and the number of isolation points', () => {
    const s = snapshotProcedure(proc())
    expect(s.pointCount).toBe(2)
    expect(s.pointKeys).toEqual(['k1', 'k2'])
    expect(s.devices.sort()).toEqual(['ball_valve_lock', 'hasp', 'safety_padlock'])
    expect(s.isolationPoints.map((p) => p.pointId)).toEqual(['E-1', 'H-1'])
    expect(s.procedureRevision).toBe(2)
  })

  it('reads the legacy single `device` field', () => {
    const s = snapshotProcedure(proc({ isolationPoints: [{ key: 'k', energySource: 'electrical', device: 'plug_cover' }] }))
    expect(s.devices).toEqual(['plug_cover'])
  })
})

describe('lockChoices', () => {
  const technicians = [
    { id: 't1', name: 'Tech One', lockNo: 'P-1' },
    { id: 't2', name: 'Tech Two', lockNo: 'P-2', active: false },
    { id: 't3', name: 'Tech Three', lockNo: 'P-3' },
  ]
  const locks = [
    { id: 'l1', lockNo: 'D-1', type: 'department' },
    { id: 'l2', lockNo: 'D-2', type: 'department', active: false },
    { id: 'l3', lockNo: 'X-9', type: 'personal' },
    { id: 'l4', lockNo: 'D-4', type: 'department' },
  ]

  it('offers active personal locks of technicians and active department locks', () => {
    const c = lockChoices({ technicians, locks })
    expect(c.personal.map((x) => x.lockNo)).toEqual(['P-1', 'P-3'])
    expect(c.department.map((x) => x.lockNo)).toEqual(['D-1', 'D-4'])
  })

  it('hides locks already applied elsewhere or already picked on this permit', () => {
    const c = lockChoices({ technicians, locks, inUse: new Set(['P-1']), chosen: ['D-1'] })
    expect(c.personal.map((x) => x.lockNo)).toEqual(['P-3'])
    expect(c.department.map((x) => x.lockNo)).toEqual(['D-4'])
  })
})

describe('validateDraft', () => {
  const NOW = Date.parse('2026-10-05T00:00:00Z')
  const base = () => {
    const snapshot = snapshotProcedure(proc())
    return {
      snapshot,
      draft: {
        workType: 'machine_maintenance',
        reason: 'Replace the drive-end bearing on pump A',
        windowStartMs: NOW + 3600e3,
        windowEndMs: NOW + 9 * 3600e3,
        internalPersonnel: [{ uid: 'u1', name: 'Asha' }],
        vendorWorkers: [],
        locks: [
          { pointKey: 'k1', lockNo: 'D-1', lockType: 'department' },
          { pointKey: 'k2', lockNo: 'D-2', lockType: 'department' },
        ],
      },
    }
  }
  const check = (mut) => {
    const b = base()
    mut?.(b)
    return validateDraft(b.draft, { snapshot: b.snapshot, nowMs: NOW })
  }

  it('passes a complete draft', () => {
    expect(check()).toEqual({})
  })

  it('requires equipment and a procedure for machine maintenance and electrical work', () => {
    for (const workType of ['machine_maintenance', 'electrical_work']) {
      const e = validateDraft({ ...base().draft, workType }, { snapshot: null, nowMs: NOW })
      expect(e.procedure, workType).toMatch(/approved LOTO procedures/)
    }
  })

  it('does not require one for other work', () => {
    const e = validateDraft({ ...base().draft, workType: 'other', locks: [] }, { snapshot: null, nowMs: NOW })
    expect(e.procedure).toBeUndefined()
    expect(e.locks).toBeUndefined()
  })

  it('refuses a procedure that is not approved', () => {
    const e = validateDraft(base().draft, { snapshot: base().snapshot, procedureStatus: 'draft', nowMs: NOW })
    expect(e.procedure).toMatch(/approved/)
  })

  it('requires a lock on every point, each different', () => {
    expect(check((b) => { b.draft.locks = [b.draft.locks[0]] }).locks).toMatch(/every isolation point/)
    expect(check((b) => { b.draft.locks[1].lockNo = 'd-1' }).locks).toMatch(/own lock number/)
  })

  it('requires Department locks when there are several points', () => {
    expect(check((b) => { b.draft.locks[0].lockType = 'personal' }).locks).toMatch(/Department lock/)
  })

  it('lets a single point use a personal lock', () => {
    const snapshot = snapshotProcedure(proc({ isolationPoints: [{ key: 'k1', energySource: 'electrical' }] }))
    const d = { ...base().draft, locks: [{ pointKey: 'k1', lockNo: 'P-1', lockType: 'personal' }] }
    expect(validateDraft(d, { snapshot, nowMs: NOW })).toEqual({})
  })

  it('requires a described job, a window and somebody doing the work', () => {
    expect(check((b) => { b.draft.reason = 'short' }).reason).toBeTruthy()
    expect(check((b) => { b.draft.windowEndMs = b.draft.windowStartMs }).window).toBeTruthy()
    expect(check((b) => { b.draft.internalPersonnel = [] }).personnel).toBeTruthy()
  })

  it('accepts contractors recorded only as text, and wants a name and company', () => {
    const ok = check((b) => { b.draft.internalPersonnel = []; b.draft.vendorWorkers = [{ name: 'A. Vendor', company: 'ACME Ltd' }] })
    expect(ok.personnel).toBeUndefined()
    expect(ok.vendorWorkers).toBeUndefined()
    expect(check((b) => { b.draft.vendorWorkers = [{ name: 'A. Vendor', company: '' }] }).vendorWorkers).toBeTruthy()
  })

  it('requires a work type', () => {
    expect(check((b) => { b.draft.workType = '' }).workType).toBeTruthy()
  })
})

describe('buildPermit', () => {
  it('carries the procedure snapshot, scope fields and one lock plan per point', () => {
    const snapshot = snapshotProcedure(proc())
    const doc = buildPermit({
      orgId: 'org1',
      user: { id: 'u9', displayName: 'Req Uester' },
      snapshot,
      draft: {
        workType: 'electrical_work', reason: ' Rewire the panel ', workOrder: ' WO-1 ',
        windowStartMs: 1, windowEndMs: 2,
        internalPersonnel: [{ uid: 'u1', name: ' Asha ' }],
        vendorWorkers: [{ name: ' V ', company: ' C ', contact: '' }],
        locks: [
          { pointKey: 'k2', lockNo: 'D-2', lockType: 'department', techName: 'Tech' },
          { pointKey: 'k1', lockNo: 'D-1', lockType: 'department' },
        ],
      },
    })
    expect(doc).toMatchObject({
      orgId: 'org1', requestedBy: 'u9', procedureId: 'p1', siteId: 's1', region: 'South', entity: 'Ent',
      pointCount: 2, reason: 'Rewire the panel', workOrder: 'WO-1',
    })
    expect(doc.locks.map((l) => [l.pointKey, l.lockNo])).toEqual([['k1', 'D-1'], ['k2', 'D-2']])
    expect(doc.internalPersonnel).toEqual([{ uid: 'u1', name: 'Asha' }])
    expect(doc.personnelUids).toEqual(['u1'])
    expect(doc.vendorWorkers[0]).toEqual({ name: 'V', company: 'C', contact: '' })
  })

  it('gives a no-equipment permit empty values, not missing keys', () => {
    const doc = buildPermit({ orgId: 'o', user: { id: 'u' }, snapshot: null, draft: { workType: 'other', reason: 'x'.repeat(12) } })
    expect(doc).toMatchObject({ procedureId: '', pointCount: 0, pointKeys: [], locks: [], isolationPoints: [] })
  })
})
