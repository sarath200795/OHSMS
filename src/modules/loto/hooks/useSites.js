import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { subscribeSites } from '../services/sites'

/** Real-time list of the current org's sites. */
export function useSites() {
  const { profile } = useAuth()
  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.orgId) return undefined
    const unsub = subscribeSites(
      profile.orgId,
      (items) => {
        setSites(items)
        setLoading(false)
      },
      () => setLoading(false),
    )
    return unsub
  }, [profile?.orgId])

  return { sites, loading }
}
