import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { subscribeTechnicians } from '../services/technicians'

/** Real-time list of the current org's authorized LOTO technicians. */
export function useTechnicians() {
  const { profile } = useAuth()
  const [technicians, setTechnicians] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.orgId) return undefined
    const unsub = subscribeTechnicians(
      profile.orgId,
      (items) => {
        setTechnicians(items)
        setLoading(false)
      },
      () => setLoading(false),
    )
    return unsub
  }, [profile?.orgId])

  return { technicians, loading }
}
