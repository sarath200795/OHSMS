import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext'
import { subscribeOrgUsers, subscribeOrg } from '../lib/firestore'
import { subscribeSites } from '../../../shared/org/orgData'
import { resolveAccessibleSites } from '../../../shared/auth/access'
import { subscribeIncidents, subscribeStats, INCIDENT_LOAD_CAP } from '../lib/incidents'
import { subscribeIllnesses } from '../lib/illnesses'
import { subscribeInjuries, injuryStatus } from '../lib/injuries'
import { flattenActions, isActionOverdue, todayISO } from '../lib/actions'

const IncidentContext = createContext(null)

/**
 * One real-time listener set for the whole authed app: incidents, illnesses,
 * org users, the org doc and the stats counter. Pages read derived slices from
 * here. NO photo/file listeners — those load per-record on open. Mirrors Fire
 * Marshal's FleetContext.
 */
export function IncidentProvider({ children }) {
  const { orgId, user, profile, isAdmin } = useAuth()
  const [incidents, setIncidents] = useState([])
  const [illnesses, setIllnesses] = useState([])
  const [injuries, setInjuries] = useState([])
  const [users, setUsers] = useState([])
  const [allSites, setAllSites] = useState([])
  const [org, setOrg] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  // Injuries and illnesses carry a named colleague's body parts, injury type,
  // medication and days off. The rules now restrict them to admin and manager;
  // this stops everyone else opening a listener that can only ever be refused,
  // which would fill the console with permission errors on a page that is
  // working correctly and make the real ones harder to see.
  const canReadHealth = isAdmin || profile?.role === 'manager'

  useEffect(() => {
    if (!orgId) return
    setLoading(true)
    let ready = false
    const done = () => { if (!ready) { ready = true; setLoading(false) } }
    const u1 = subscribeIncidents(orgId, (list) => { setIncidents(list); done() })
    const u3 = subscribeOrgUsers(orgId, setUsers)
    const u4 = subscribeOrg(orgId, setOrg)
    const u5 = subscribeStats(orgId, setStats)
    const u7 = subscribeSites(orgId, setAllSites)
    const noop = () => {}
    const u2 = canReadHealth ? subscribeIllnesses(orgId, setIllnesses) : noop
    const u6 = canReadHealth ? subscribeInjuries(orgId, setInjuries) : noop
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7() }
  }, [orgId, canReadHealth])

  // Sites the current user is permitted to log incidents against.
  const sites = useMemo(
    () => resolveAccessibleSites(profile, allSites, { isAdmin }),
    [allSites, profile, isAdmin]
  )

  const value = useMemo(() => {
    const today = todayISO()
    const active = incidents.filter((i) => !i.deletedAt)
    const deletedIncidents = incidents.filter((i) => i.deletedAt)
    const activeIll = illnesses.filter((i) => !i.deletedAt)
    const deletedIllnesses = illnesses.filter((i) => i.deletedAt)

    const allActions = flattenActions(active, activeIll)
    const openActions = allActions.filter((a) => a.status !== 'closed')
    const overdueActions = allActions.filter((a) => isActionOverdue(a, today))
    const myAssignedActions = allActions.filter((a) => a.ownerUid && a.ownerUid === user?.uid && a.status !== 'closed')

    // Body-part aggregate (injuries + illnesses) for the dashboard heatmap.
    const bodyPartCounts = {}
    for (const inc of active) {
      for (const r of inc.injuryReports || []) {
        for (const key of r.bodyParts || []) bodyPartCounts[key] = (bodyPartCounts[key] || 0) + 1
      }
    }
    for (const ill of activeIll) {
      for (const key of ill.affectedBodyParts || []) bodyPartCounts[key] = (bodyPartCounts[key] || 0) + 1
    }

    const pendingInjuries = injuries.filter((i) => injuryStatus(i) !== 'verified')

    return {
      loading,
      org,
      stats,
      users,
      sites,
      pendingUsers: users.filter((u) => u.status === 'pending'),
      incidents: active,
      deletedIncidents,
      illnesses: activeIll,
      deletedIllnesses,
      injuries,
      pendingInjuries,
      allActions,
      openActions,
      overdueActions,
      myAssignedActions,
      bodyPartCounts,
      capped: incidents.length >= INCIDENT_LOAD_CAP,
      loadCap: INCIDENT_LOAD_CAP,
    }
  }, [incidents, illnesses, injuries, users, sites, org, stats, loading, user])

  return <IncidentContext.Provider value={value}>{children}</IncidentContext.Provider>
}

export function useIncidents() {
  const ctx = useContext(IncidentContext)
  if (!ctx) throw new Error('useIncidents must be used within IncidentProvider')
  return ctx
}
