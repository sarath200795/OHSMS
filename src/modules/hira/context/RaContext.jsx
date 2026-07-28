import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from './AuthContext'
import { subscribeAssessments, subscribeOrg, subscribeActivity } from '../lib/firestore'
import { subscribeSites } from '../../../shared/org/orgData'
import { resolveAccessibleSites } from '../../../shared/auth/access'
import { summarize } from '../lib/raStats'

const RaContext = createContext(null)

/** One real-time listener for the org's risk assessments + org doc; pages read slices. */
export function RaProvider({ children }) {
  const { orgId, profile, isAdmin } = useAuth()
  const [assessments, setAssessments] = useState([])
  const [org, setOrg] = useState(null)
  const [activity, setActivity] = useState([])
  const [allSites, setAllSites] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) return
    setLoading(true)
    // If a listener is denied/fails, stop loading so the UI shows an empty state
    // (with a one-time toast) instead of a perpetual spinner or blank screen.
    let warned = false
    const onErr = (err) => {
      setLoading(false)
      if (!warned) {
        warned = true
        toast.error(
          err?.code === 'permission-denied'
            ? "You don't have access to this organization's data."
            : 'Could not load live data. Check your connection.'
        )
      }
    }
    const u1 = subscribeAssessments(orgId, (list) => {
      setAssessments(list)
      setLoading(false)
    }, onErr)
    const u2 = subscribeOrg(orgId, setOrg, onErr)
    const u3 = subscribeActivity(orgId, setActivity, onErr)
    const u4 = subscribeSites(orgId, setAllSites)
    return () => { u1(); u2(); u3(); u4() }
  }, [orgId])

  const siteInventory = useMemo(
    () => resolveAccessibleSites(profile, allSites, { isAdmin }),
    [allSites, profile, isAdmin]
  )

  const value = useMemo(() => ({
    loading,
    assessments,
    org,
    sites: org?.sites || [],
    siteInventory,
    activity,
    // Stats exclude baselines (they're activity templates, not live site risks).
    summary: summarize(assessments.filter((a) => a.kind !== 'baseline')),
  }), [assessments, org, siteInventory, activity, loading])

  return <RaContext.Provider value={value}>{children}</RaContext.Provider>
}

export function useRa() {
  const ctx = useContext(RaContext)
  if (!ctx) throw new Error('useRa must be used within RaProvider')
  return ctx
}
