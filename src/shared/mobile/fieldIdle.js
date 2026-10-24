// Idle loops for the home icons, after the entrance and apart from the press.
//
// The entrance owns the tile and the press owns the link. This motion sits
// on the mark, so the three do not fight over one transform. Neighbours get
// different phases — and, where it reads, different motions — so a row does
// not bob on one beat.
//
// 3D module logos already have their own loops. `phaseMs` is negative so
// those loops are already underway; a shared zero would start every pen,
// spray and bar on the same frame.

export const IDLE_MOTIONS = ['float', 'sway', 'pulse', 'glow']

// Assigned so the phone grid's usual order does not repeat a motion on the
// next tile. A key missing here still gets one of the four, from its index.
const MOTION_BY_KEY = {
  extinguishers: 'sway',
  aed: 'pulse',
  fas: 'glow',
  signage: 'float',
  stretchers: 'float',
  firstAid: 'pulse',
  defects: 'sway',
  incidents: 'glow',
  ptw: 'float',
  loto: 'sway',
  hira: 'pulse',
  inspections: 'float',
  audit: 'glow',
  drills: 'pulse',
  committee: 'float',
  weather: 'glow',
  training: 'pulse',
  documents: 'float',
  emergency: 'glow',
  objectives: 'pulse',
  cctv: 'sway',
  stakeholder: 'float',
  actions: 'pulse',
  sites: 'float',
  reports: 'pulse',
  users: 'pulse',
  settings: 'sway',
  auditLog: 'float',
  maintenance: 'glow',
  analytics: 'sway',
  equipment: 'sway',
}

const DURATION_MS = { float: 4200, sway: 3600, pulse: 2800, glow: 3300 }

function hash(key) {
  let h = 0
  const s = String(key || '')
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i) * (i + 1)) % 97
  return h
}

export function fieldIdle(key, index = 0) {
  const i = Number.isFinite(index) ? Math.abs(index) : 0
  const motion = MOTION_BY_KEY[key] || IDLE_MOTIONS[i % IDLE_MOTIONS.length]
  const h = hash(key)
  return {
    motion,
    // The entrance is 420ms. The idle waits it out, then starts off-beat.
    delayMs: 480 + (i % 6) * 220 + (h % 5) * 90,
    durationMs: DURATION_MS[motion] + (h % 4) * 280,
    phaseMs: -((h % 9) * 140 + (i % 5) * 90 + 80),
  }
}
