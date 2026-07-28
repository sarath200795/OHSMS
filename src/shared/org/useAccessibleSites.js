import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { resolveAccessibleSites } from '../auth/access'
import { subscribeSites } from './orgData'

/**
 * The sites this user may see, live. Replaces the subscribe-then-resolve pair
 * every module was repeating; the underlying sites listener is shared app-wide.
 *
 * Pass `sites` to resolve an already-subscribed list instead of opening one.
 */
export function useAccessibleSites(sites) {
  const { orgId, profile, isAdmin } = useAuth()
  const [own, setOwn] = useState([])
  const external = sites !== undefined

  useEffect(() => {
    if (external || !orgId) return undefined
    return subscribeSites(orgId, setOwn)
  }, [external, orgId])

  const all = external ? sites : own
  return useMemo(() => resolveAccessibleSites(profile, all || [], { isAdmin }), [profile, all, isAdmin])
}

/** Distinct region / entity option lists derived from a site list. */
export function useSiteFacets(sites = []) {
  return useMemo(() => ({
    regions: [...new Set(sites.map((s) => s.region).filter(Boolean))].sort(),
    entities: [...new Set(sites.map((s) => s.entity).filter(Boolean))].sort(),
  }), [sites])
}
