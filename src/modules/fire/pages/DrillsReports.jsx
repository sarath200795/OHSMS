import { useAuth } from '../../../shared/auth/AuthContext'
import { toCsv } from '../../../shared/lib/csv'
import { downloadText } from '../../../shared/lib/download'
import ModuleReportsPage from '../../../shared/reports/ModuleReportsPage'
import IncompleteNotice from '../../../shared/ui/IncompleteNotice'
import DrillsTab from '../../../pages/analytics/DrillsTab'
import { useFleet } from '../context/FleetContext'

const COLUMNS = [
  { key: 'docId', label: 'ID' },
  { key: 'kind', label: 'Kind' },
  { key: 'site', label: 'Site' },
  { key: 'date', label: 'Date' },
  { key: 'score', label: 'Score' },
]

export default function DrillsReports() {
  const { isAdmin } = useAuth()
  const { mockDrills, siteInventory, incomplete } = useFleet()

  const onExport = () => {
    const rows = (mockDrills || []).map((d) => ({
      docId: d.docId || d.id || '',
      kind: d.kind || d.type || (d.isEmergency ? 'Emergency' : 'Drill'),
      site: d.centerName || d.siteName || '',
      date: d.date || d.drillDate || '',
      score: d.score ?? '',
    }))
    downloadText(toCsv(rows, COLUMNS), 'mock-drills-report.csv')
  }

  return (
    <ModuleReportsPage
      moduleKey="drills"
      subtitle="Mock drills and real emergencies for the sites you can see. Same figures as Analytics → Mock Drills."
      onExport={onExport}
    >
      <IncompleteNotice incomplete={incomplete} className="mb-5" />
      <DrillsTab drills={mockDrills} sites={siteInventory} keepUnplaced={isAdmin} />
    </ModuleReportsPage>
  )
}
