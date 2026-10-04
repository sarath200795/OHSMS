import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { subscribePermit, subscribePermits } from '../services/permits'

/** Real-time list of the current org's LOTO permits, newest first. */
export function usePermits() {
  const { profile } = useAuth()
  const [permits, setPermits] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.orgId) return undefined
    return subscribePermits(
      profile.orgId,
      (items) => {
        setPermits(items)
        setLoading(false)
      },
      () => setLoading(false),
    )
  }, [profile?.orgId])

  return { permits, loading }
}

/** One permit, live. `permit` is null once loaded if it does not exist. */
export function usePermit(permitNo) {
  const { profile } = useAuth()
  const [state, setState] = useState({ permit: undefined, loading: true })

  useEffect(() => {
    if (!profile?.orgId || !permitNo) return undefined
    return subscribePermit(
      profile.orgId,
      permitNo,
      (permit) => setState({ permit, loading: false }),
      () => setState({ permit: null, loading: false }),
    )
  }, [profile?.orgId, permitNo])

  return state
}

/** A clock that ticks once a minute so due/overdue badges move without a reload. */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}
