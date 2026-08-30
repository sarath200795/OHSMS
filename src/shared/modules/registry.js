// ─────────────────────────────────────────────────────────────────────────────
// Module registry — the single source of truth for the OHS modules. Drives the
// sidebar nav, the dashboard module grid, and route mounting in App.jsx.
// Each module's feature code lives in src/modules/<key>/, with one exception:
// 'equipment' and 'drills' are two entries served by src/modules/fire/.
//
// The count is deliberately not written down here. It said "10" while this
// array held 17, and a number in a comment beside the array it describes is a
// fact that goes stale the first time someone adds an entry. Count the array.
// ─────────────────────────────────────────────────────────────────────────────
import {
  Cctv,
  Scale,
  AlertTriangle,
  ShieldAlert,
  ClipboardCheck,
  FileSearch,
  FileCheck,
  Lock,
  FireExtinguisher,
  Siren,
  Users,
  GraduationCap,
  FolderOpen,
  ListChecks,
  PhoneCall,
  Gauge,
  CloudSun,
  Radar,
} from 'lucide-react'

export const MODULES = [
  {
    key: 'incidents',
    label: 'Incidents',
    title: 'Incidents & Investigation',
    path: '/incidents',
    icon: AlertTriangle,
    tone: 'red',
    description: 'Report incidents & near-misses, run 5-Why / Fishbone investigations, track CAPA.',
    collection: 'incidents',
  },
  {
    key: 'hira',
    label: 'Risk Assessment',
    title: 'Hazard Identification & Risk Assessment',
    path: '/hira',
    icon: ShieldAlert,
    tone: 'amber',
    description: 'Hazard register with a likelihood × severity risk matrix and controls.',
    collection: 'assessments',
  },
  {
    key: 'inspections',
    label: 'Inspections',
    title: 'Inspections',
    path: '/inspections',
    icon: ClipboardCheck,
    tone: 'blue',
    description: 'Scheduled inspections and checklist walkthroughs with findings.',
    collection: 'inspections',
  },
  {
    key: 'audit',
    label: 'Internal Audit',
    title: 'Internal Audit',
    path: '/audit',
    icon: FileSearch,
    tone: 'violet',
    description: 'ISO 45001 audit plans, findings and corrective actions.',
    collection: 'audits',
  },
  {
    key: 'ptw',
    label: 'Permit to Work',
    title: 'Permit to Work',
    path: '/permits',
    icon: FileCheck,
    tone: 'green',
    description: 'Raise, approve and close work permits with QR verification.',
    collection: 'permits',
  },
  {
    key: 'loto',
    label: 'Lockout / Tagout',
    title: 'Lockout / Tagout (Energy Control)',
    path: '/loto',
    icon: Lock,
    tone: 'brand',
    description: 'Hazardous energy control procedures and lock/tag records.',
    collection: 'lotoProcedures',
  },
  {
    key: 'equipment',
    label: 'Equipment',
    title: 'Emergency Equipment Inventory',
    path: '/equipment',
    icon: FireExtinguisher,
    tone: 'red',
    description: 'Fire extinguishers, AEDs, fire-alarm systems and signages with full inspection lifecycle.',
    collection: 'extinguishers',
  },
  {
    key: 'drills',
    label: 'Mock Drills',
    title: 'Mock Drills',
    path: '/mock-drills',
    icon: Siren,
    tone: 'amber',
    description: 'Log fire drills and emergency scenarios with scored checklist reports.',
    collection: 'mockDrills',
  },
  {
    key: 'committee',
    label: 'HSE Committee',
    title: 'HSE Committee Meetings',
    path: '/committee',
    icon: Users,
    tone: 'blue',
    description: 'Schedule committee meetings, capture minutes and track actions.',
    collection: 'meetings',
  },
  {
    key: 'training',
    label: 'Training',
    title: 'Training & Certifications',
    path: '/training',
    icon: GraduationCap,
    tone: 'green',
    description: 'Courses, certifications and expiry alerts.',
    collection: 'trainingRecords',
    isNew: true,
  },
  {
    key: 'documents',
    label: 'Documents & SDS',
    title: 'Document Library & SDS',
    path: '/documents',
    icon: FolderOpen,
    tone: 'brand',
    description: 'Versioned policies, SOPs, forms and Safety Data Sheets.',
    collection: 'documents',
    isNew: true,
  },
  {
    key: 'emergency',
    label: 'Emergency Response',
    title: 'Emergency Response (FERP)',
    path: '/emergency-response',
    icon: PhoneCall,
    tone: 'red',
    description: 'Site emergency repository — FERP contacts (external & internal), evacuation plans and scenario rescue plans.',
    collection: 'erpContacts',
    isNew: true,
  },
  {
    key: 'objectives',
    label: 'Objectives & Targets',
    title: 'Objectives & Targets',
    path: '/objectives',
    icon: Gauge,
    tone: 'violet',
    description: 'OH&S KPI scorecard — audit pass, ticket closure, equipment uptime and incidents against target at org, region and site level.',
    collection: 'objectives',
    isNew: true,
  },
  {
    key: 'weather',
    label: 'Weather Risk',
    title: 'Site Weather Risk',
    path: '/weather',
    icon: CloudSun,
    tone: 'blue',
    description: 'Current conditions at every site read as occupational risk — heat stress, wind limits for work at height, lightning, rain, UV and visibility.',
    collection: '',
    isNew: true,
  },
  {
    key: 'cctv',
    label: 'CCTV',
    title: 'CCTV Inventory & Health',
    path: '/cctv',
    icon: Cctv,
    tone: 'slate',
    description:
      'Cameras, DVRs and Meraki devices as one chain — so a dead switch reads as one network fault rather than forty broken cameras. Health, uptime and defects kept separate per device kind.',
    collection: 'cctvCameras',
    isNew: true,
  },
  {
    key: 'stakeholder',
    label: 'Stakeholder Issues',
    title: 'Customer Escalations & Legal Issues',
    path: '/stakeholder',
    icon: Scale,
    tone: 'amber',
    description:
      'Customer escalations and the legal matters they turn into — members involved, departments that visited, notices served, and the crossover between the two that neither list shows on its own.',
    collection: 'escalations',
    isNew: true,
  },
  {
    key: 'actions',
    label: 'Action Tracker',
    title: 'Central Action Tracker',
    path: '/actions',
    icon: ListChecks,
    tone: 'violet',
    description: 'Every CAPA & action item across all modules, with status you update in place — changes write back to the source.',
    collection: '',
    isNew: true,
  },
]

export const MODULE_BY_KEY = Object.fromEntries(MODULES.map((m) => [m.key, m]))

// ─────────────────────────────────────────────────────────────────────────────
// Add-ons — licensed the same way as a module, but not one.
//
// An operator switches these per organization on the Module access screen, and
// entitlements govern them exactly as they govern MODULES. What they are NOT is
// navigable: they have no path, no route and no tile, because they live inside
// a screen that already exists. Putting one in MODULES would render a dashboard
// tile linking to `undefined`, which is why they are a separate list rather
// than a flag on that one.
//
// ── optIn, and why it has to exist ──────────────────────────────────────────
//
// Entitlements are opt-OUT everywhere else: absent means enabled, so that
// shipping a new module does not withhold it from every existing tenant until
// somebody re-saves each one. That default is right for a module and wrong for
// these. ODIN reads a Metabase warehouse almost nobody has; enabled-by-default
// it was a tab on every tenant in the estate whose whole content was an
// invitation to connect a product they had never heard of.
//
// So an `optIn` add-on is OFF until an operator says otherwise — the exact
// inverse, declared here rather than assumed at each call site. See
// isModuleEnabled.
// ─────────────────────────────────────────────────────────────────────────────
export const ADDONS = [
  {
    key: 'odin',
    label: 'ODIN',
    title: 'ODIN — warehouse analytics',
    icon: Radar,
    tone: 'teal',
    description:
      'FLS audit scores and remediation tickets read live from a Metabase warehouse, as two tabs in Analytics. Needs a connection in Settings → Integrations.',
    optIn: true,
  },
]

export const ADDON_BY_KEY = Object.fromEntries(ADDONS.map((a) => [a.key, a]))

/** Add-on keys that are off until switched on. */
export const OPT_IN_KEYS = ADDONS.filter((a) => a.optIn).map((a) => a.key)

// Longest path first, so /equipment/aed cannot match a shorter sibling.
const BY_PATH = [...MODULES].filter((m) => m.path).sort((a, b) => b.path.length - a.path.length)

/** The module a pathname belongs to, or null for admin/portal routes. */
export function moduleForPath(pathname = '') {
  return BY_PATH.find((m) => pathname === m.path || pathname.startsWith(`${m.path}/`)) || null
}
