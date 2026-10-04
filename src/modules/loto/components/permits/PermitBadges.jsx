import Badge from '../ui/Badge'
import { PERMIT_STATUS_META } from '../../constants/permits'
import { formatSpan } from '../../utils/permitWindow'

export function PermitStatusBadge({ status }) {
  const meta = PERMIT_STATUS_META[status]
  return <Badge className={meta?.accent || 'border-steel-600 bg-steel-800 text-steel-300'}>{meta?.label || status}</Badge>
}

/** The window clock: nothing for a closed permit (`clock` is null). */
export function PermitClockBadge({ clock }) {
  if (!clock) return null
  if (clock.state === 'overdue') {
    return (
      <Badge className="border-danger/40 bg-danger/15 text-danger">
        Overdue {formatSpan(clock.overdueMs)}
      </Badge>
    )
  }
  if (clock.state === 'due') {
    return (
      <Badge className="border-amber-300 bg-amber-100 text-amber-800">
        Due in {formatSpan(clock.msToEnd)}
      </Badge>
    )
  }
  if (clock.state === 'upcoming') {
    return <Badge className="border-steel-600 bg-steel-800 text-steel-300">Window not open</Badge>
  }
  return null
}
