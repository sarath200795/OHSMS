import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  subscribeOrgEvents,
  subscribeOrgProcedures,
} from '../services/procedures'

/** Real-time list of the current org's procedures. */
export function useOrgProcedures() {
  const { profile } = useAuth()
  const [procedures, setProcedures] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.orgId) return undefined
    const unsub = subscribeOrgProcedures(
      profile.orgId,
      (items) => {
        setProcedures(items)
        setLoading(false)
      },
      () => setLoading(false),
    )
    return unsub
  }, [profile?.orgId])

  return { procedures, loading }
}

/** Real-time append-only LOTO activity log for the current org. */
export function useOrgEvents() {
  const { profile } = useAuth()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.orgId) return undefined
    const unsub = subscribeOrgEvents(
      profile.orgId,
      (items) => {
        setEvents(items)
        setLoading(false)
      },
      () => setLoading(false),
    )
    return unsub
  }, [profile?.orgId])

  return { events, loading }
}
