import { useMemo } from 'react'
import { useAuth } from '../auth/AuthContext'
import { normalizeErpRoleLabels } from './erpRoles'

/**
 * The organization's own titles for the emergency response roles.
 * Baseline plans ship with role placeholders; this is what turns them into
 * language the people on site actually use.
 */
export function useErpRoleLabels() {
  const { org } = useAuth()
  return useMemo(() => normalizeErpRoleLabels(org?.erpRoleLabels), [org])
}
