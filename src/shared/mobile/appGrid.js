// The phone home is an app grid, not a second copy of the desktop dashboard.
//
// Every tile is a place the same person can already open. Entitlements decide
// which modules exist for the organisation; can() decides the admin tools.
// Hiding a tile is presentation — the route guard is still the control — but
// a tile that opens a page the route will refuse is a dead button on a phone,
// which is the failure this list exists to avoid.
import {
  BarChart3,
  Bed,
  Bell,
  Building2,
  Cog,
  Cross,
  FireExtinguisher,
  HeartPulse,
  ScrollText,
  Settings,
  Signpost,
  UsersRound,
  Wrench,
} from 'lucide-react'
import { can } from '../auth/permissions'
import { enabledModules } from '../modules/entitlements'
import { MODULE_BY_KEY } from '../modules/registry'

// Fills are the palette's own dark stops, written as arbitrary values so they
// stay saturated. The Tailwind 700 tokens are the text-on-wash stops, and
// pairing those with white is what the hygiene check refuses.
const FILL = {
  extinguishers: 'bg-[#c43d32]',
  aed: 'bg-[#9d2c4a]',
  fas: 'bg-[#c45c12]',
  signage: 'bg-[#92400e]',
  stretchers: 'bg-[#4a6578]',
  firstAid: 'bg-[#3f6e32]',
  defects: 'bg-[#a8342a]',
  incidents: 'bg-[#c43d32]',
  ptw: 'bg-[#3f6e32]',
  loto: 'bg-[#2457a6]',
  hira: 'bg-[#92400e]',
  inspections: 'bg-[#2457a6]',
  audit: 'bg-[#5b3a8c]',
  drills: 'bg-[#c45c12]',
  committee: 'bg-[#246058]',
  weather: 'bg-[#2457a6]',
  training: 'bg-[#3f6e32]',
  documents: 'bg-[#6b4e32]',
  emergency: 'bg-[#c43d32]',
  objectives: 'bg-[#5b3a8c]',
  cctv: 'bg-[#4a6578]',
  stakeholder: 'bg-[#92400e]',
  actions: 'bg-[#5b3a8c]',
  sites: 'bg-[#246058]',
  reports: 'bg-[#2457a6]',
  users: 'bg-[#3f6e32]',
  settings: 'bg-[#6b4e32]',
  auditLog: 'bg-[#5b3a8c]',
  maintenance: 'bg-[#4a6578]',
}

// Equipment is one module and five jobs. A single "Equipment" tile is how a
// person in the field misses the extinguisher register.
const EQUIPMENT = [
  {
    key: 'extinguishers',
    label: 'Extinguishers',
    to: '/equipment/extinguishers',
    icon: FireExtinguisher,
  },
  { key: 'aed', label: 'AED', to: '/equipment/aed', icon: HeartPulse },
  { key: 'fas', label: 'FAS', to: '/equipment/fas', icon: Bell },
  { key: 'signage', label: 'Signage', to: '/equipment/signages', icon: Signpost },
  { key: 'defects', label: 'Defects', to: '/equipment/defects', icon: Wrench },
  { key: 'stretchers', label: 'Stretchers', to: '/equipment/stretchers', icon: Bed },
  { key: 'firstAid', label: 'First aid', to: '/equipment/first-aid', icon: Cross },
]

const SHORT = {
  hira: 'HIRA',
  ptw: 'Permits',
  loto: 'LOTO',
  drills: 'Mock drills',
  committee: 'Meetings',
  emergency: 'Emergency',
  weather: 'Weather',
  stakeholder: 'Stakeholders',
  documents: 'Documents',
  objectives: 'Objectives',
}

// The order a field person scans the grid in. Anything not listed follows,
// still only when that module is on.
const LEADING = [
  'extinguishers',
  'aed',
  'fas',
  'signage',
  'incidents',
  'ptw',
  'loto',
  'hira',
  'defects',
  'drills',
  'committee',
  'weather',
  'sites',
  'emergency',
  'reports',
  'settings',
]

function tile(partial) {
  return { fill: FILL[partial.key] || 'bg-brand-600', ...partial }
}

/**
 * Tiles this person may open.
 *
 * `moduleMap` is the normalized entitlement map (absent means the module is
 * on). `role` is the profile role can() already understands.
 */
export function fieldApps({ moduleMap, role } = {}) {
  const enabled = new Set(enabledModules(moduleMap).map((m) => m.key))
  const byKey = new Map()

  if (enabled.has('equipment')) {
    for (const item of EQUIPMENT) byKey.set(item.key, tile(item))
  }

  for (const mod of enabledModules(moduleMap)) {
    if (mod.key === 'equipment') continue
    byKey.set(
      mod.key,
      tile({
        key: mod.key,
        label: SHORT[mod.key] || mod.label,
        to: mod.path,
        icon: MODULE_BY_KEY[mod.key]?.icon || mod.icon,
      })
    )
  }

  if (can(role, 'record.view')) {
    byKey.set('sites', tile({ key: 'sites', label: 'Sites', to: '/sites', icon: Building2 }))
    byKey.set(
      'reports',
      tile({ key: 'reports', label: 'Reports', to: '/analytics', icon: BarChart3 })
    )
  }
  if (can(role, 'user.manage')) {
    byKey.set('users', tile({ key: 'users', label: 'Employees', to: '/users', icon: UsersRound }))
  }
  if (can(role, 'org.settings')) {
    byKey.set(
      'settings',
      tile({ key: 'settings', label: 'Settings', to: '/settings', icon: Settings })
    )
    byKey.set(
      'maintenance',
      tile({ key: 'maintenance', label: 'Maintenance', to: '/maintenance', icon: Cog })
    )
  }
  if (can(role, 'audit.view')) {
    byKey.set(
      'auditLog',
      tile({ key: 'auditLog', label: 'Audit log', to: '/audit-log', icon: ScrollText })
    )
  }

  const ordered = []
  for (const key of LEADING) {
    const item = byKey.get(key)
    if (item) ordered.push(item)
  }
  for (const [key, item] of byKey) {
    if (!LEADING.includes(key)) ordered.push(item)
  }
  return ordered
}
