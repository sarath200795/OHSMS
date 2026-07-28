const TONES = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
}

export default function Badge({ tone = 'slate', children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

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
