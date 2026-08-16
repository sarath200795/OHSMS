// Internal-audit badge. The pill itself is the shared chip — this module's tone
// names (slate/brand/green/amber/red/blue) are all already in the shared map, so
// nothing here needs its own copy of the markup. The status→tone tables below
// are audit vocabulary and stay local.
export { Badge as default } from '../../../../shared/ui'

// Shared status -> tone/label mappings used across findings, CAPA and audits.
export const STATUS_TONES = {
  // findings
  open: 'red',
  in_progress: 'amber',
  closed: 'green',
  // audits
  planned: 'blue',
  completed: 'green',
  // capa
  verified: 'brand',
  // users
  pending: 'amber',
  approved: 'green',
  rejected: 'slate',
}

export const SEVERITY_TONES = {
  observation: 'blue',
  minor: 'amber',
  major: 'red',
}

export function labelize(value) {
  if (!value) return ''
  return value
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
