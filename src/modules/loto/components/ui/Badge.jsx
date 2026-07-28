import { ROLE_META, USER_STATUS } from '../../constants/roles'

export default function Badge({ children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${className}`}
    >
      {children}
    </span>
  )
}

export function RoleBadge({ role }) {
  const meta = ROLE_META[role]
  if (!meta) {
    return <Badge className="border-steel-600 bg-steel-800 text-steel-300">No role</Badge>
  }
  return <Badge className={meta.accent}>{meta.short}</Badge>
}

const STATUS_STYLES = {
  [USER_STATUS.PENDING]: 'border-amber-300 bg-amber-100 text-amber-800',
  [USER_STATUS.APPROVED]: 'border-safe/40 bg-safe/15 text-safe',
  [USER_STATUS.REJECTED]: 'border-danger/40 bg-danger/15 text-danger',
}

export function StatusBadge({ status }) {
  const cls = STATUS_STYLES[status] || 'border-steel-600 bg-steel-800 text-steel-300'
  return <Badge className={cls}>{status}</Badge>
}
