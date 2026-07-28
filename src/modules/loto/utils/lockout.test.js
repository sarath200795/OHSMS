import {
  collectInUseLockNos,
  collectLockUsage,
  lockoutDeviceTally,
} from './lockout'

const boxProcedure = {
  equipment: 'UPS 80',
  site: 'Plant A',
  isolationPoints: [
    {
      key: 'a',
      energySource: 'electrical',
      devices: ['safety_padlock'],
      lockState: { locked: true, techLockNo: 'DEPT-01', techName: 'Lead', lockType: 'department' },
    },
    {
      key: 'b',
      energySource: 'mechanical',
      devices: ['ball_valve_lock'],
      lockState: { locked: true, techLockNo: 'DEPT-02', techName: 'Lead', lockType: 'department' },
    },
  ],
  groupLock: {
    active: true,
    method: 'box',
    members: [
      { techId: 't1', name: 'Ann', boxLock: 'LK-11' },
      { techId: 't2', name: 'Bob', boxLock: 'LK-12' },
    ],
  },
}

const haspProcedure = {
  ...boxProcedure,
  groupLock: {
    active: true,
    method: 'hasp',
    members: [{ techId: 't1', name: 'Ann', locks: { a: 'DEPT-03', b: 'DEPT-04' } }],
  },
}

describe('lockoutDeviceTally', () => {
  it('box: point locks + one padlock per technician + one box', () => {
    const tally = lockoutDeviceTally(boxProcedure)
    expect(tally.safety_padlock).toBe(3) // 1 point lock + 2 box padlocks
    expect(tally.ball_valve_lock).toBe(1)
    expect(tally.group_loto_box).toBe(1)
    expect(tally.hasp).toBeUndefined()
  })

  it('hasp: a padlock per point per member + a hasp per stacked point', () => {
    const tally = lockoutDeviceTally(haspProcedure)
    expect(tally.safety_padlock).toBe(3) // 1 point lock + 2 member padlocks
    expect(tally.ball_valve_lock).toBe(1)
    expect(tally.hasp).toBe(2)
    expect(tally.group_loto_box).toBeUndefined()
  })

  it('counts every selected device on a locked point', () => {
    const tally = lockoutDeviceTally({
      isolationPoints: [
        { key: 'a', devices: ['safety_padlock', 'cable_lockout'], lockState: { locked: true } },
      ],
    })
    expect(tally.safety_padlock).toBe(1)
    expect(tally.cable_lockout).toBe(1)
  })
})

describe('collectInUseLockNos', () => {
  it('includes point locks and box padlocks', () => {
    const set = collectInUseLockNos([boxProcedure])
    expect([...set].sort()).toEqual(['DEPT-01', 'DEPT-02', 'LK-11', 'LK-12'])
  })

  it('includes per-point hasp member locks', () => {
    const set = collectInUseLockNos([haspProcedure])
    expect(set.has('DEPT-03')).toBe(true)
    expect(set.has('DEPT-04')).toBe(true)
  })
})

describe('collectLockUsage', () => {
  it('maps a lock number to its equipment and point', () => {
    const usage = collectLockUsage([boxProcedure])
    expect(usage.get('DEPT-01')).toMatchObject({ equipment: 'UPS 80', label: 'E-1' })
    expect(usage.get('LK-11')).toMatchObject({ equipment: 'UPS 80', label: 'Group box' })
  })
})
