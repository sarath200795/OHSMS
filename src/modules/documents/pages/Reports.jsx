import { useAuth } from '../../../shared/auth/AuthContext'
import ModuleReportsPage from '../../../shared/reports/ModuleReportsPage'
import PreLaunchTab from '../../../pages/analytics/PreLaunchTab'
import { useAccessibleSites } from '../../../shared/org/useAccessibleSites'

export default function Reports() {
  const { orgId } = useAuth()
  const sites = useAccessibleSites()

  return (
    <ModuleReportsPage
      moduleKey="documents"
      subtitle="Pre-launch handover readiness per site — paperwork that does not exist yet. Same figures as Analytics → Pre-Launch Readiness."
    >
      <PreLaunchTab sites={sites} orgId={orgId} />
    </ModuleReportsPage>
  )
}
