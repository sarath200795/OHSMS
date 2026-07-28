import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../../shared/auth/AuthContext'
import { subscribeOrgCollection } from '../../../shared/org/orgData'
import { useAccessibleSites, useSiteFacets } from '../../../shared/org/useAccessibleSites'
import { subscribeActions } from '../../actions/lib/sources'
import { subscribeObjectives } from '../lib/firestore'

const ObjectivesContext = createContext(null)

// Raw collections the KPI engine measures. All shared app-wide, so opening the
// scorecard costs no extra reads when these modules are already mounted.
const SOURCES = {
  auditReports: 'auditFindings',
  extinguishers: 'extinguishers',
  fas: 'fas',
  signages: 'signages',
  incidents: 'incidents',
}
const EMPTY = Object.fromEntries(Object.keys(SOURCES).map((k) => [k, []]))

/** Targets plus live module records, so KPI actuals are never snapshotted. */
export function ObjectivesProvider({ children }) {
  const { orgId } = useAuth()
  const [objectives, setObjectives] = useState(null)
  const [raw, setRaw] = useState(EMPTY)
  const [rawActions, setRawActions] = useState([])
  const sites = useAccessibleSites()
  const { regions, entities } = useSiteFacets(sites)

  useEffect(() => {
    if (!orgId) return undefined
    const unsubs = [
      subscribeObjectives(orgId, setObjectives),
      subscribeActions(orgId, setRawActions),
      ...Object.entries(SOURCES).map(([key, name]) =>
        subscribeOrgCollection(orgId, name, (rows) => setRaw((r) => ({ ...r, [key]: rows }))),
      ),
    ]
    return () => unsubs.forEach((u) => u && u())
  }, [orgId])

  const value = useMemo(() => ({
    loading: objectives === null,
    objectives: objectives || [],
    // Action Tracker rows use `norm`; the KPI engine reads `status`.
    data: { ...raw, actions: rawActions.map((a) => ({ ...a, status: a.norm })) },
    sites,
    regions,
    entities,
    regionScopes: regions.map((r) => ({ value: r, label: r })),
    siteScopes: sites.map((s) => ({ value: s.id, label: s.name, region: s.region, entity: s.entity })),
  }), [objectives, raw, rawActions, sites, regions, entities])

  return <ObjectivesContext.Provider value={value}>{children}</ObjectivesContext.Provider>
}

export function useObjectives() {
  const ctx = useContext(ObjectivesContext)
  if (!ctx) throw new Error('useObjectives must be used within ObjectivesProvider')
  return ctx
}
