// ─────────────────────────────────────────────────────────────────────────────
// CCTV vocabulary.
//
// The important distinction in this module is between a device being BROKEN and
// a device being DARK. A camera whose lens is smeared is broken. A camera that
// stopped answering because the switch above it lost power is dark — nothing is
// wrong with the camera, and sending a technician to look at it wastes a visit.
//
// Everything here is named to keep those apart.
// ─────────────────────────────────────────────────────────────────────────────

/** What a device itself reports. Anything unrecognised is treated as unknown. */
export const STATUS = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  UNKNOWN: 'unknown',
}

/**
 * Why a device is not working — the part that makes the reports trustworthy.
 *
 * `self` means this device is the problem. `dvr` and `meraki` mean it is a
 * casualty of something upstream and should not be counted as its own fault.
 */
export const CAUSE = {
  SELF: 'self',
  DVR: 'dvr',
  MERAKI: 'meraki',
  NONE: 'none',
}

export const CAUSE_LABEL = {
  [CAUSE.SELF]: 'Device fault',
  [CAUSE.DVR]: 'DVR down',
  [CAUSE.MERAKI]: 'Meraki down',
  [CAUSE.NONE]: '—',
}

/**
 * Camera defects.
 *
 * `offline` is derived from connectivity and is never hand-entered — it is set
 * by the health pass so a camera cannot be marked offline while it is happily
 * streaming. The rest are things a person sees on a monitor and are independent
 * of connectivity: a camera can be perfectly online and pointed at a wall.
 */
export const CAMERA_DEFECTS = [
  { key: 'offline', label: 'Offline', derived: true, tone: 'red' },
  { key: 'blur', label: 'Blur', derived: false, tone: 'amber' },
  { key: 'blocked', label: 'Blocked', derived: false, tone: 'amber' },
  { key: 'angle', label: 'Angle not proper', derived: false, tone: 'blue' },
]

/** The ones a person can raise by hand. */
export const REPORTABLE_CAMERA_DEFECTS = CAMERA_DEFECTS.filter((d) => !d.derived)

export const CAMERA_DEFECT_BY_KEY = Object.fromEntries(CAMERA_DEFECTS.map((d) => [d.key, d]))

export const DVR_DEFECTS = [
  { key: 'offline', label: 'Offline', derived: true, tone: 'red' },
  { key: 'recording_failure', label: 'Not recording', derived: false, tone: 'red' },
  { key: 'disk_full', label: 'Storage full', derived: false, tone: 'amber' },
  { key: 'disk_fault', label: 'Disk fault', derived: false, tone: 'amber' },
  { key: 'time_drift', label: 'Time/date wrong', derived: false, tone: 'blue' },
]
export const REPORTABLE_DVR_DEFECTS = DVR_DEFECTS.filter((d) => !d.derived)
export const DVR_DEFECT_BY_KEY = Object.fromEntries(DVR_DEFECTS.map((d) => [d.key, d]))

export const MERAKI_DEFECTS = [
  { key: 'offline', label: 'Offline', derived: true, tone: 'red' },
  { key: 'degraded', label: 'Degraded / packet loss', derived: false, tone: 'amber' },
  { key: 'port_fault', label: 'Port fault', derived: false, tone: 'amber' },
]
export const REPORTABLE_MERAKI_DEFECTS = MERAKI_DEFECTS.filter((d) => !d.derived)
export const MERAKI_DEFECT_BY_KEY = Object.fromEntries(MERAKI_DEFECTS.map((d) => [d.key, d]))

/** Health bands, applied to a percentage of devices actually working. */
export const HEALTH_BANDS = [
  { key: 'good', label: 'Healthy', min: 95, tone: 'emerald' },
  { key: 'fair', label: 'Attention', min: 80, tone: 'amber' },
  { key: 'poor', label: 'Degraded', min: 50, tone: 'orange' },
  { key: 'critical', label: 'Critical', min: 0, tone: 'red' },
]

export const healthBand = (pct) =>
  HEALTH_BANDS.find((b) => pct >= b.min) || HEALTH_BANDS[HEALTH_BANDS.length - 1]
