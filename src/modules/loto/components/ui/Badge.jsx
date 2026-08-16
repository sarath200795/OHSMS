import { Badge as SharedBadge } from '../../../../shared/ui'
import { ROLE_META, USER_STATUS } from '../../constants/roles'

/**
 * The shared chip, colourless. Every loto caller passes a full set of colour
 * classes — `PROCEDURE_STATUS_META.accent`, `ROLE_META.accent` and the rest —
 * so `tone="none"` keeps the shared shape without a tone fighting them.
 */
export default function Badge({ children, className = '', ...rest }) {
  return (
    <SharedBadge tone="none" className={className} {...rest}>
      {children}
    </SharedBadge>
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
