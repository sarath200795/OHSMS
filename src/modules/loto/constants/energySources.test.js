import { ENERGY_SOURCES, deviceLabel, pointDeviceKeys, pointDevicesLabel } from './energySources'

describe('energy colours — the hecp-loto tag sheet', () => {
  it('keeps the six prefixes and the colours printed on the tags', () => {
    expect(ENERGY_SOURCES.map((e) => [e.key, e.prefix, e.color, e.textColor])).toEqual([
      ['electrical', 'E', '#e23b2e', '#ffffff'],
      ['mechanical', 'M', '#2f7fe2', '#ffffff'],
      ['hydraulic', 'H', '#2faa57', '#ffffff'],
      ['pneumatic', 'P', '#ff7a00', '#11161f'],
      ['chemical', 'C', '#f5c518', '#11161f'],
      ['gravitational', 'G', '#9b51e0', '#ffffff'],
    ])
  })
})

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
