import { deviceLabel, pointDeviceKeys, pointDevicesLabel } from './energySources'

describe('pointDeviceKeys', () => {
  it('reads the new devices array', () => {
    expect(pointDeviceKeys({ devices: ['safety_padlock', 'hasp'] })).toEqual([
      'safety_padlock',
      'hasp',
    ])
  })
  it('falls back to the legacy single device', () => {
    expect(pointDeviceKeys({ device: 'ball_valve_lock' })).toEqual(['ball_valve_lock'])
  })
  it('returns [] when none', () => {
    expect(pointDeviceKeys({})).toEqual([])
  })
})

describe('pointDevicesLabel', () => {
  it('joins human labels', () => {
    expect(pointDevicesLabel({ devices: ['safety_padlock', 'hasp'] })).toBe('Safety Padlock, Hasp')
  })
  it('shows a dash when empty', () => {
    expect(pointDevicesLabel({})).toBe('—')
  })
})

describe('deviceLabel', () => {
  it('labels known and group hardware', () => {
    expect(deviceLabel('safety_padlock')).toBe('Safety Padlock')
    expect(deviceLabel('group_loto_box')).toBe('Group LOTO Box')
  })
})
