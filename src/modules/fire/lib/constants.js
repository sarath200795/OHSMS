// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for every enum, dropdown option, and color used across
// forms, badges, charts, dashboard and repository. Import from here only.
// ─────────────────────────────────────────────────────────────────────────────

// Extinguisher Type
export const TYPES = ['ABC', 'CO2', 'Modular']

// Capacity options
export const CAPACITIES = ['2 Kg', '4.5 Kg', '5 Kg', '6 Kg']

// Entity / business unit
// Entity uses the site registry's vocabulary — it is the system of record for
// what a site is. Equipment arrived from a standalone system labelled 1P/2P/3P,
// which turned out to be the same axis under different names.
export const ENTITIES = ['COCO', 'FOCO', 'FOFO', 'Marketplace', 'Fitso', 'EBO', 'Pilate']

/**
 * Legacy equipment labels, still accepted on upload so existing exports keep
 * working. The translation is approximate on purpose — 1P is usually COCO but
 * sometimes FOFO, and 2P spans FOFO and FOCO — so it is only a starting value:
 * linking an asset to its site overwrites entity with the site's own, which is
 * exact. Never present these as choices; they exist to avoid rejecting a file.
 */
export const LEGACY_ENTITIES = { '1P': 'COCO', '2P': 'FOFO', '3P': 'Marketplace' }
export const normalizeEntity = (v) => {
  const s = String(v ?? '').trim()
  return LEGACY_ENTITIES[s] || s
}

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
// One hue per entity, in ENTITIES order. The order is the colour-blind-safety
// mechanism: adjacent bars in the "By Entity" chart are the pairs that touch, so
// neighbouring slots are the ones that have to stay apart under protanopia and
// deuteranopia. Validated as a set — worst adjacent pair is amber↔green at
// ΔE 9.1 (protan) and 22.9 (normal vision). Re-run the check before re-ordering
// ENTITIES or swapping a hue; don't eyeball it.
//
// Four of these sit below 3:1 against the clay surface, which is allowed only
// because the chart direct-labels every bar with its count and the repository
// table carries the same numbers.
export const ENTITY_COLORS = {
  COCO: '#2a78d6',
  FOCO: '#eb6834',
  FOFO: '#1baf7a',
  Marketplace: '#eda100',
  Fitso: '#4a3aa7',
  EBO: '#e87ba4',
  Pilate: '#008300',
  // Assets uploaded before the site-registry link still carry the old labels and
  // are not normalised on read, so they keep the colour of what they map to.
  '1P': '#2a78d6',
  '2P': '#1baf7a',
  '3P': '#eda100',
}

// Anything outside the vocabulary — slate, so it reads as "unclassified" rather
// than impersonating an entity.
export const ENTITY_FALLBACK_COLOR = '#64748b'

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

// The catch-all every asset defect sheet ends with. Named rather than repeated
// so the modal can recognise it and insist on a note — a bare "Other" tells an
// approver nothing, and it is the one option whose meaning lives in the note.
export const OTHER_DEFECT = 'Other'

// Defects a public QR scanner can report against an AED. Battery and pads are
// split into expiry vs condition because they are different failures with
// different fixes — an expired pad is a reorder, a damaged one is immediate.
export const AED_DEFECTS = [
  'Battery Discharged',
  'Battery Expired',
  'Pads Expired',
  'Pads Damaged',
  'Key availability for AED box',
  OTHER_DEFECT,
]

// ── First aid boxes (site-wise contents & availability) ──────────────────────
// Tracked exactly like signage: the unit of measurement is a (site, item) pair,
// not a box. A site is asked the same question about every item on this list,
// so "does this site have a first aid box" — which every site answers yes to —
// is replaced by "which of the contents are actually in it".
//
// `minQty` is the count a box is expected to hold. It is what makes the
// availability real: a box holding one bandage is not stocked, and a plain
// present/absent flag cannot say so.
//
// `expires` marks the items with a shelf life. Those are scored against their
// expiry date as well as their count — a full-looking box of out-of-date
// antiseptic is the failure this register exists to catch, and a count alone
// reads it as compliance.
export const FIRST_AID_ITEMS = [
  { name: 'Adhesive Bandages', minQty: 20, expires: false },
  { name: 'Sterile Gauze Pads', minQty: 10, expires: true },
  { name: 'Cotton Wool Roll', minQty: 2, expires: false },
  { name: 'Roller Bandage', minQty: 4, expires: false },
  { name: 'Triangular Bandage', minQty: 2, expires: false },
  { name: 'Adhesive Tape', minQty: 2, expires: false },
  { name: 'Antiseptic Solution', minQty: 1, expires: true },
  { name: 'Burn Dressing', minQty: 2, expires: true },
  { name: 'Eye Wash Solution', minQty: 1, expires: true },
  { name: 'ORS Sachets', minQty: 4, expires: true },
  { name: 'Disposable Gloves', minQty: 4, expires: true },
  { name: 'Scissors', minQty: 1, expires: false },
  { name: 'Tweezers / Forceps', minQty: 1, expires: false },
  { name: 'CPR Face Shield', minQty: 1, expires: true },
  { name: 'Instant Ice Pack', minQty: 2, expires: true },
  { name: 'First Aid Manual', minQty: 1, expires: false },
]

export const FIRST_AID_ITEM_NAMES = FIRST_AID_ITEMS.map((i) => i.name)
export const FIRST_AID_ITEM_BY_NAME = Object.fromEntries(FIRST_AID_ITEMS.map((i) => [i.name, i]))

// The condition recorded against one item in one box.
//
// 'Expired' is its own value rather than a note beside 'Available' because
// expired stock is not stock. It is counted on its own on the dashboard and it
// does not count toward availability — see firstAidLogic, where that is the
// rule both the matrix and the dashboard read.
export const FIRST_AID_CONDITIONS = ['Available', 'Low Stock', 'Expired', 'Damaged', 'Missing']

export const FIRST_AID_CONDITION_COLOR = {
  Available: '#16a34a',
  'Low Stock': '#f59e0b',
  Expired: '#dc2626',
  Damaged: '#ea580c',
  Missing: '#b91c1c',
}

// ── Stretchers (site-wise emergency evacuation assets) ───────────────────────
// The same asset shape as an AED: one physical unit, one QR code, an inspection
// cycle and a public defect sheet.
export const STRETCHER_TYPES = [
  'Foldable',
  'Scoop',
  'Spine Board',
  'Wheeled',
  'Basket / Rescue',
  'Other',
]

export const STRETCHER_STATUS = {
  READY: 'ready',
  SERVICE_DUE: 'service_due',
  OUT_OF_SERVICE: 'out_of_service',
}
export const STRETCHER_STATUS_LABEL = {
  [STRETCHER_STATUS.READY]: 'Ready',
  [STRETCHER_STATUS.SERVICE_DUE]: 'Service Due',
  [STRETCHER_STATUS.OUT_OF_SERVICE]: 'Out of Service',
}
export const STRETCHER_STATUS_COLOR = {
  [STRETCHER_STATUS.READY]: '#16a34a',
  [STRETCHER_STATUS.SERVICE_DUE]: '#f59e0b',
  [STRETCHER_STATUS.OUT_OF_SERVICE]: '#dc2626',
}

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
  OTHER_DEFECT,
]

// Defects a public QR scanner can report against a stretcher. Physical rather
// than electronic: what stops a stretcher being used is a torn deck, a seized
// wheel or a missing strap, and none of those has a due date to catch it first.
export const STRETCHER_DEFECTS = [
  'Straps Missing / Torn',
  'Frame Bent or Cracked',
  'Fabric / Deck Torn',
  'Wheels or Brakes Faulty',
  'Locking Mechanism Faulty',
  'Stretcher Not at Its Location',
  'Access Blocked',
  OTHER_DEFECT,
]

// Asset-kind → its public-reportable defect list.
export const ASSET_DEFECTS = { aed: AED_DEFECTS, fas: FAS_DEFECTS, stretcher: STRETCHER_DEFECTS }

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
  // Optional: an existing printed QR value (full URL or bare token). Blank mints
  // a new code, so organizations with labels already on the wall keep them.
  'QR Link',
]
