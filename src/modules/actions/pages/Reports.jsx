import { useAuth } from '../../../shared/auth/AuthContext'
import ModuleReportsPage from '../../../shared/reports/ModuleReportsPage'
import ActionsTab from '../../../pages/analytics/ActionsTab'
import { useAccessibleSites } from '../../../shared/org/useAccessibleSites'

export default function Reports() {
  const { orgId, isAdmin } = useAuth()
  const sites = useAccessibleSites()

  return (
    <ModuleReportsPage
      moduleKey="actions"
      subtitle="Open, overdue and closed actions across every module, for the sites you can see. Same figures as Analytics → Action Tracker."
    >
      <ActionsTab orgId={orgId} sites={sites} keepUnplaced={isAdmin} />
    </ModuleReportsPage>
  )
}
