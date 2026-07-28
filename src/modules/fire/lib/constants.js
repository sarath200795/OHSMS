// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for every enum, dropdown option, and color used across
// forms, badges, charts, dashboard and repository. Import from here only.
// ─────────────────────────────────────────────────────────────────────────────

// Extinguisher Type
export const TYPES = ['ABC', 'CO2', 'Modular']

// Capacity options
export const CAPACITIES = ['2 Kg', '4.5 Kg', '5 Kg', '6 Kg']

// Entity / business unit
export const ENTITIES = ['1P', '2P', '3P', 'Fitso', 'EBO']

// Geographic region
export const REGIONS = ['North', 'South', 'East', 'West']
export const DEFAULT_REGION = 'North'

// Who is reporting a defect via a public QR scan
export const REPORTER_ROLES = ['CM', 'Safety', 'CLM', 'Member', 'Vendor', 'Others']

// Lifecycle status of an extinguisher
export const STATUS = {
  ACTIVE: 'active',
  TO_BE_REFILLED: 'to_be_refilled',
  IN_PROCESS_REFILLING: 'in_process_refilling',
  CLOSED: 'closed',
}

export const STATUS_LABEL = {
  [STATUS.ACTIVE]: 'Active',
  [STATUS.TO_BE_REFILLED]: 'To Be Refilled',
  [STATUS.IN_PROCESS_REFILLING]: 'In Process of Refilling',
  [STATUS.CLOSED]: 'Refilled & Closed',
}

export const STATUS_COLOR = {
  [STATUS.ACTIVE]: '#16a34a',
  [STATUS.TO_BE_REFILLED]: '#f59e0b',
  [STATUS.IN_PROCESS_REFILLING]: '#6366f1',
  [STATUS.CLOSED]: '#0ea5e9',
}

// ── Defect definitions ───────────────────────────────────────────────────────
// `triggersRefill: true` means reporting this defect sends the extinguisher to
// the "To Be Refilled" list; otherwise it goes to the "Physical Defects" list.
export const DEFECTS = [
  { key: 'pin', label: 'PIN', color: '#a855f7', triggersRefill: false },
  { key: 'stand', label: 'Stand', color: '#0891b2', triggersRefill: false },
  { key: 'hose_pipe', label: 'Hose Pipe Damage', color: '#d97706', triggersRefill: false },
  { key: 'handle', label: 'Handle Damage', color: '#db2777', triggersRefill: false },
  { key: 'empty', label: 'Empty', color: '#dc2626', triggersRefill: true },
  { key: 'over_pressurized', label: 'Over Pressurized', color: '#e11d48', triggersRefill: true },
]

export const DEFECT_BY_KEY = Object.fromEntries(DEFECTS.map((d) => [d.key, d]))
export const REFILL_DEFECT_KEYS = DEFECTS.filter((d) => d.triggersRefill).map((d) => d.key)
export const PHYSICAL_DEFECT_KEYS = DEFECTS.filter((d) => !d.triggersRefill).map((d) => d.key)

// ── Dashboard / repository category color map ────────────────────────────────
// Every category that can be filtered or charted. Healthy is always green.
export const CATEGORIES = {
  HEALTHY: { key: 'HEALTHY', label: 'No Defects (Healthy)', color: '#16a34a' },
  PIN: { key: 'pin', label: 'PIN', color: '#a855f7' },
  STAND: { key: 'stand', label: 'Stand', color: '#0891b2' },
  HOSE: { key: 'hose_pipe', label: 'Hose Pipe Damage', color: '#d97706' },
  HANDLE: { key: 'handle', label: 'Handle Damage', color: '#db2777' },
  EMPTY: { key: 'empty', label: 'Empty', color: '#dc2626' },
  OVER_PRESSURIZED: { key: 'over_pressurized', label: 'Over Pressurized', color: '#e11d48' },
  HPT_DUE_30: { key: 'HPT_DUE_30', label: 'HPT Due in 30', color: '#f59e0b' },
  HPT_DUE: { key: 'HPT_DUE', label: 'HPT Due', color: '#b45309' },
  REFILL_DUE_30: { key: 'REFILL_DUE_30', label: 'Refilling Due in 30', color: '#facc15' },
  REFILL_DUE: { key: 'REFILL_DUE', label: 'Refilling Due', color: '#ea580c' },
}

export const CATEGORY_LIST = Object.values(CATEGORIES)

// Window (in days) before a due date when an item is flagged as "due soon".
export const DUE_SOON_DAYS = 30

// Chart palettes (kept consistent across the app)
export const TYPE_COLORS = { ABC: '#f73838', CO2: '#6366f1', Modular: '#0891b2' }
export const ENTITY_COLORS = {
  '1P': '#f59e0b',
  '2P': '#10b981',
  '3P': '#3b82f6',
  Fitso: '#a855f7',
  EBO: '#ec4899',
}
export const REGION_COLORS = {
  North: '#3b82f6',
  South: '#f59e0b',
  East: '#10b981',
  West: '#a855f7',
}

// ── Safety signage (site-wise signage inventory) ─────────────────────────────
export const SIGNAGE_TYPES = [
  'Stretcher Signage',
  'Fire Order Signage',
  'Dug Out Emergency Contacts',
  'FERP Signage',
  'Lift Emergency Contacts',
  'MCP Signage',
  'FAS Panel Signage',
  'Fire Exit',
  'Assembly Point',
  'Fire Extinguisher Sign',
  'No Smoking',
  'Directional Arrow',
  'First Aid',
  'Electrical Room Danger Sign',
]

// Signage types where capturing the floor is meaningful (per-floor records).
export const FLOOR_SIGNAGE_TYPES = ['FERP Signage']

export const SIGNAGE_CONDITIONS = ['OK', 'Faded', 'Damaged', 'Missing', 'Obstructed']

export const SIGNAGE_CONDITION_COLOR = {
  OK: '#16a34a',
  Faded: '#f59e0b',
  Damaged: '#ea580c',
  Missing: '#dc2626',
  Obstructed: '#b45309',
}

// ── AED (Automated External Defibrillator) inventory ─────────────────────────
export const AED_STATUS = {
  READY: 'ready',
  SERVICE_DUE: 'service_due',
  OUT_OF_SERVICE: 'out_of_service',
}
export const AED_STATUS_LABEL = {
  [AED_STATUS.READY]: 'Ready',
  [AED_STATUS.SERVICE_DUE]: 'Service Due',
  [AED_STATUS.OUT_OF_SERVICE]: 'Out of Service',
}
export const AED_STATUS_COLOR = {
  [AED_STATUS.READY]: '#16a34a',
  [AED_STATUS.SERVICE_DUE]: '#f59e0b',
  [AED_STATUS.OUT_OF_SERVICE]: '#dc2626',
}

// Defects a public QR scanner can report against an AED.
export const AED_DEFECTS = [
  'Battery Issue',
  'Lock Issue',
  'Pads Expired',
  'Pads Missing',
  'Battery Expired / Discharged',
]

// ── FAS (Fire Alarm System) device inventory ─────────────────────────────────
export const FAS_DEVICE_TYPES = [
  'Control Panel',
  'Smoke Detector',
  'Heat Detector',
  'Manual Call Point',
  'Sounder / Hooter',
  'Beam Detector',
  'Repeater Panel',
  'Other',
]
export const FAS_STATUS = {
  OPERATIONAL: 'operational',
  SERVICE_DUE: 'service_due',
  FAULTY: 'faulty',
}
export const FAS_STATUS_LABEL = {
  [FAS_STATUS.OPERATIONAL]: 'Operational',
  [FAS_STATUS.SERVICE_DUE]: 'Service Due',
  [FAS_STATUS.FAULTY]: 'Faulty',
}
export const FAS_STATUS_COLOR = {
  [FAS_STATUS.OPERATIONAL]: '#16a34a',
  [FAS_STATUS.SERVICE_DUE]: '#f59e0b',
  [FAS_STATUS.FAULTY]: '#dc2626',
}

// Defects a public QR scanner can report against a FAS Control Panel — covers
// the whole system, including detector and manual-call-point faults.
export const FAS_DEFECTS = [
  'Battery Discharged',
  'UPS / Power Issue',
  'System Unhealthy',
  'Smoke Detector Not Working',
  'Heat Detector Not Working',
  'Manual Call Point (MCP) Faulty',
  'Hooter Not Working',
  'Isolated Zone',
  'Other',
]

// Asset-kind → its public-reportable defect list.
export const ASSET_DEFECTS = { aed: AED_DEFECTS, fas: FAS_DEFECTS }

// Columns used for xlsx bulk upload template + export
export const BULK_COLUMNS = [
  'Serial No',
  'Type',
  'Capacity',
  'Entity',
  'Region',
  'Center Name',
  'Date of Deployment',
  'Date of Next Refill',
  'Date of Next HPT',
]
