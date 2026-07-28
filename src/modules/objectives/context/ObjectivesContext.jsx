import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../../../shared/firebase'
import { useAuth } from '../../../shared/auth/AuthContext'
import { subscribeSites } from '../../../shared/org/orgData'
import { resolveAccessibleSites } from '../../../shared/auth/access'
import { subscribeActions } from '../../actions/lib/sources'
import { subscribeObjectives } from '../lib/firestore'

const ObjectivesContext = createContext(null)

/** Live subscription to a plain org sub-collection. */
function subCol(orgId, name, cb) {
  return onSnapshot(
    collection(db, 'organizations', orgId, name),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => cb([]),
  )
}

/**
 * Feeds the scorecard: targets plus every module's raw records, so KPI actuals
 * are always live rather than snapshotted.
 */
export function ObjectivesProvider({ children }) {
  const { orgId, profile, isAdmin } = useAuth()
  const [objectives, setObjectives] = useState(null)
  const [auditReports, setAuditReports] = useState([])
  const [rawActions, setRawActions] = useState([])
  const [extinguishers, setExtinguishers] = useState([])
  const [fas, setFas] = useState([])
  const [signages, setSignages] = useState([])
  const [incidents, setIncidents] = useState([])
  const [allSites, setAllSites] = useState([])

  useEffect(() => {
    if (!orgId) return undefined
    const unsubs = [
      subscribeObjectives(orgId, setObjectives),
      subCol(orgId, 'auditFindings', setAuditReports),
      subscribeActions(orgId, setRawActions),
      subCol(orgId, 'extinguishers', setExtinguishers),
      subCol(orgId, 'fas', setFas),
      subCol(orgId, 'signages', setSignages),
      subCol(orgId, 'incidents', setIncidents),
      subscribeSites(orgId, setAllSites),
    ]
    return () => unsubs.forEach((u) => u && u())
  }, [orgId])

  const value = useMemo(() => {
    const sites = resolveAccessibleSites(profile, allSites, { isAdmin })
    // Action Tracker rows use `norm`; the KPI engine reads `status`.
    const actions = rawActions.map((a) => ({ ...a, status: a.norm }))
    const regions = [...new Set(sites.map((s) => s.region).filter(Boolean))].sort()
    const entities = [...new Set(sites.map((s) => s.entity).filter(Boolean))].sort()
    return {
      loading: objectives === null,
      objectives: objectives || [],
      data: { auditReports, actions, extinguishers, fas, signages, incidents },
      sites,
      regions,
      entities,
      // Scope option lists for the drill-downs
      regionScopes: regions.map((r) => ({ value: r, label: r })),
      siteScopes: sites.map((s) => ({ value: s.id, label: s.name, region: s.region, entity: s.entity })),
    }
  }, [objectives, auditReports, rawActions, extinguishers, fas, signages, incidents, allSites, profile, isAdmin])

  return <ObjectivesContext.Provider value={value}>{children}</ObjectivesContext.Provider>
}

export function useObjectives() {
  const ctx = useContext(ObjectivesContext)
  if (!ctx) throw new Error('useObjectives must be used within ObjectivesProvider')
  return ctx
}
