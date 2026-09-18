import { useAuth } from '../../../shared/auth/AuthContext'
import { toCsv } from '../../../shared/lib/csv'
import { downloadText } from '../../../shared/lib/download'
import ModuleReportsPage from '../../../shared/reports/ModuleReportsPage'
import InspectionsTab from '../../../pages/analytics/InspectionsTab'
import { useData } from '../context/DataContext'

const COLUMNS = [
  { key: 'docId', label: 'ID' },
  { key: 'template', label: 'Checklist' },
  { key: 'site', label: 'Site' },
  { key: 'completedAt', label: 'Completed' },
  { key: 'score', label: 'Score' },
]

export default function Reports() {
  const { isAdmin } = useAuth()
  const { records, sites } = useData()

  const onExport = () => {
    const rows = (records || []).map((r) => ({
      docId: r.docId || r.id || '',
      template: r.templateName || r.formName || '',
      site: r.siteName || r.siteId || '',
      completedAt: r.completedAt || '',
      score: r.score ?? r.pct ?? '',
    }))
    downloadText(toCsv(rows, COLUMNS), 'inspections-report.csv')
  }

  return (
    <ModuleReportsPage
      moduleKey="inspections"
      subtitle="Completed checklists for the sites you can see. Same figures as Analytics → Inspections."
      onExport={onExport}
    >
      <InspectionsTab records={records} sites={sites} keepUnplaced={isAdmin} />
    </ModuleReportsPage>
  )
}
