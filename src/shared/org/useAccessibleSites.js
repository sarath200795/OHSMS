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

  // Gated on an APPROVED profile, not just an orgId.
  //
  // orgId outlives the thing the rule actually checks. isApprovedMemberOf reads
  // the profile on every re-evaluation, so a listener opened on orgId alone
  // stays open across sign-out and token refresh and re-evaluates with auth
  // that no longer satisfies it — permission-denied, on a session that is
  // simply ending. It was a race: sometimes React tore the listener down first,
  // sometimes the listener answered first and logged "every site picker will
  // look empty" at somebody whose app was working perfectly.
  //
  // Depending on the profile means the listener cannot open before it could
  // succeed, and closes the moment it could not.
  const canRead = Boolean(orgId && profile?.status === 'approved')

  useEffect(() => {
    if (external || !canRead) return undefined
    return subscribeSites(orgId, setOwn)
  }, [external, canRead, orgId])

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
