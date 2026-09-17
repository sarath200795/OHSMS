// Lazy loaders for each operating module. The registry is the product list;
// this is how a standalone app (or the combined shell) actually mounts one.
export const MODULE_LOADERS = {
  incidents: () => import('../modules/incidents'),
  hira: () => import('../modules/hira'),
  inspections: () => import('../modules/inspections'),
  audit: () => import('../modules/audit'),
  ptw: () => import('../modules/ptw'),
  loto: () => import('../modules/loto'),
  equipment: () => import('../modules/fire'),
  drills: () => import('../modules/fire/DrillsModule'),
  committee: () => import('../modules/committee'),
  training: () => import('../modules/training'),
  documents: () => import('../modules/documents'),
  emergency: () => import('../modules/emergency'),
  objectives: () => import('../modules/objectives'),
  weather: () => import('../modules/weather'),
  cctv: () => import('../modules/cctv'),
  stakeholder: () => import('../modules/stakeholder'),
  actions: () => import('../modules/actions'),
}
