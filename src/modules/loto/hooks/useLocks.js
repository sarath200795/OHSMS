import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { subscribeLocks } from '../services/locks'

/** Real-time list of the current org's physical locks (the Lock Inventory). */
export function useLocks() {
  const { profile } = useAuth()
  const [locks, setLocks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.orgId) return undefined
    const unsub = subscribeLocks(
      profile.orgId,
      (items) => {
        setLocks(items)
        setLoading(false)
      },
      () => setLoading(false),
    )
    return unsub
  }, [profile?.orgId])

  return { locks, loading }
}
