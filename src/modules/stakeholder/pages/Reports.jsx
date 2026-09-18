import { useAuth } from '../../../shared/auth/AuthContext'
import { toCsv } from '../../../shared/lib/csv'
import { downloadText } from '../../../shared/lib/download'
import ModuleReportsPage from '../../../shared/reports/ModuleReportsPage'
import StakeholderTab from '../../../pages/analytics/StakeholderTab'
import { useStakeholder } from '../context/StakeholderContext'

const COLUMNS = [
  { key: 'kind', label: 'Kind' },
  { key: 'docId', label: 'ID' },
  { key: 'site', label: 'Site' },
  { key: 'status', label: 'Status' },
  { key: 'raisedOn', label: 'Date' },
]

export default function Reports() {
  const { isAdmin } = useAuth()
  const { escalations, legalIssues, sites } = useStakeholder()

  const onExport = () => {
    const rows = [
      ...(escalations || []).map((e) => ({
        kind: 'Escalation',
        docId: e.docId || e.id || '',
        site: e.siteName || e.siteId || '',
        status: e.status || '',
        raisedOn: e.raisedOn || e.date || '',
      })),
      ...(legalIssues || []).map((e) => ({
        kind: 'Legal',
        docId: e.docId || e.id || '',
        site: e.siteName || e.siteId || '',
        status: e.status || '',
        raisedOn: e.incidentDate || e.date || '',
      })),
    ]
    downloadText(toCsv(rows, COLUMNS), 'stakeholder-report.csv')
  }

  return (
    <ModuleReportsPage
      moduleKey="stakeholder"
      subtitle="Customer escalations, legal issues, and the crossover between them. Same figures as Analytics → Stakeholder Issues."
      onExport={onExport}
    >
      <StakeholderTab
        escalations={escalations}
        legalIssues={legalIssues}
        sites={sites}
        keepUnplaced={isAdmin}
      />
    </ModuleReportsPage>
  )
}
