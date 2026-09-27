import { Link } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useFleet } from '../context/FleetContext'
import { canOpenRecycleBin, countRestorable, PURGE_AFTER_DAYS } from '../lib/recycle'

export const RECYCLE_BIN_PATH = '/equipment/recycle'

// Which FleetContext slice holds the deleted rows of each kind.
const SOURCES = {
  extinguisher: 'deletedExtinguishers',
  aed: 'deletedAeds',
  fas: 'deletedFas',
}
const ALL_KINDS = Object.keys(SOURCES)

/**
 * Whether to show a way into Recently deleted, and how many units in it this
 * person could restore. `kinds` narrows the count to one register's own bin
 * rows (the page itself still lists every kind).
 */
export function useRecycleBinEntry(kinds = ALL_KINDS) {
  const fleet = useFleet() || {}
  const { profile, isAdmin, isManager } = useAuth()
  const flags = { isAdmin, isManager }
  const visible = canOpenRecycleBin(profile, flags)
  const count = visible
    ? kinds.reduce((n, kind) => n + countRestorable(fleet[SOURCES[kind]], profile, flags), 0)
    : 0
  return { visible, count }
}

/** Red pill with a count; nothing when the count is zero. */
export function BinCountBadge({ count }) {
  if (!count) return null
  return (
    <span
      data-testid="recycle-count"
      className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold leading-5 text-white"
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

/**
 * The button on each register's header that opens Recently deleted.
 *
 * It used to be reachable only from the last pill of the module tab strip,
 * which scrolls sideways and sits off-screen on a phone, and none of the
 * registers where a delete happens pointed at it. Shown even when the bin is
 * empty, so the way back is there before anyone needs it.
 */
export default function RecentlyDeletedLink({ kinds = ALL_KINDS, noun = 'units' }) {
  const { visible, count } = useRecycleBinEntry(kinds)
  if (!visible) return null
  return (
    <Link
      to={RECYCLE_BIN_PATH}
      className="btn-ghost"
      title={
        count
          ? `${count} deleted ${noun} can be restored within ${PURGE_AFTER_DAYS} days`
          : `Deleted ${noun} stay here for ${PURGE_AFTER_DAYS} days and can be restored`
      }
    >
      <Trash2 size={16} aria-hidden="true" /> Recently deleted
      <BinCountBadge count={count} />
    </Link>
  )
}
