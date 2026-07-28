// ---------------------------------------------------------------------------
// Energy sources, isolation-point numbering prefixes & color codes.
// Defined now so the LOTO procedure builder (later phase) auto-numbers
// isolation points as E-1, M-1, H-1 ... and color-codes them consistently.
// ---------------------------------------------------------------------------

export const ENERGY_SOURCES = [
  {
    key: 'electrical',
    label: 'Electrical Energy',
    prefix: 'E',
    color: '#e23b2e', // red
    textColor: '#ffffff',
  },
  {
    key: 'mechanical',
    label: 'Mechanical Energy',
    prefix: 'M',
    color: '#2f7fe2', // blue
    textColor: '#ffffff',
  },
  {
    key: 'hydraulic',
    label: 'Hydraulic Energy',
    prefix: 'H',
    color: '#2faa57', // green
    textColor: '#ffffff',
  },
  {
    key: 'pneumatic',
    label: 'Pneumatic Energy',
    prefix: 'P',
    color: '#ff7a00', // orange
    textColor: '#11161f',
  },
  {
    key: 'chemical',
    label: 'Chemical Energy',
    prefix: 'C',
    color: '#f5c518', // yellow
    textColor: '#11161f',
  },
  {
    key: 'gravitational',
    label: 'Gravitational Energy',
    prefix: 'G',
    color: '#9b51e0', // purple
    textColor: '#ffffff',
  },
]

// LOTO hardware device types selectable per isolation point.
export const LOTO_DEVICES = [
  { key: 'safety_padlock', label: 'Safety Padlock' },
  { key: 'hasp', label: 'Hasp' },
  { key: 'pin_inout', label: 'Pin In/Pin Out Device' },
  { key: 'ball_valve_lock', label: 'Ball Valve Lock' },
  { key: 'gate_valve_lock', label: 'Gate Valve Lock' },
  { key: 'plug_cover', label: 'Plug Cover' },
  { key: 'cable_lockout', label: 'Cable Lockout' },
  { key: 'flange_blind', label: 'Flange Blind' },
]

// Group-lock hardware key (added to the "devices in use" tally, NOT selectable
// as a per-point isolation device).
export const GROUP_LOTO_BOX = 'group_loto_box'

// Labels for non-selectable + legacy device keys.
const EXTRA_DEVICE_LABELS = {
  group_loto_box: 'Group LOTO Box',
  padlock: 'Safety Padlock', // legacy
  electrical: 'Electrical Lockout Device', // legacy
  valve: 'Valve Lockout Device', // legacy
}

/** Human label for any device key (selectable, group hardware, or legacy). */
export function deviceLabel(key) {
  return (
    LOTO_DEVICES.find((d) => d.key === key)?.label ||
    EXTRA_DEVICE_LABELS[key] ||
    key ||
    '—'
  )
}

/**
 * Device keys selected for an isolation point. Supports the new multi-device
 * `devices: []` field and falls back to the legacy single `device` string.
 */
export function pointDeviceKeys(point) {
  if (Array.isArray(point?.devices)) return point.devices.filter(Boolean)
  return point?.device ? [point.device] : []
}

/** Comma-joined human labels of an isolation point's LOTO devices. */
export function pointDevicesLabel(point) {
  const keys = pointDeviceKeys(point)
  return keys.length ? keys.map(deviceLabel).join(', ') : '—'
}

export function energySourceByKey(key) {
  return ENERGY_SOURCES.find((e) => e.key === key) || null
}
