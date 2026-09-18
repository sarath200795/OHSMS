import { useAuth } from '../../../shared/auth/AuthContext'
import { toCsv } from '../../../shared/lib/csv'
import { downloadText } from '../../../shared/lib/download'
import ModuleReportsPage from '../../../shared/reports/ModuleReportsPage'
import IncompleteNotice from '../../../shared/ui/IncompleteNotice'
import EquipmentTab from '../../../pages/analytics/EquipmentTab'
import { useFleet } from '../context/FleetContext'

const COLUMNS = [
  { key: 'kind', label: 'Kind' },
  { key: 'code', label: 'Code' },
  { key: 'site', label: 'Site' },
  { key: 'status', label: 'Status' },
  { key: 'location', label: 'Location' },
]

function rowsOf(kind, list, codeKey = 'assetCode') {
  return (list || []).map((a) => ({
    kind,
    code: a[codeKey] || a.serialNo || a.id || '',
    site: a.centerName || a.siteName || '',
    status: a.status || a.condition || '',
    location: a.location || a.area || '',
  }))
}

export default function EquipmentReports() {
  const { isAdmin } = useAuth()
  const { extinguishers, aeds, fas, stretchers, firstAid, siteInventory, incomplete } = useFleet()

  const onExport = () => {
    const rows = [
      ...rowsOf('Extinguisher', extinguishers),
      ...rowsOf('AED', aeds),
      ...rowsOf('Fire alarm', fas),
      ...rowsOf('Stretcher', stretchers),
      ...rowsOf('First aid', firstAid),
    ]
    downloadText(toCsv(rows, COLUMNS), 'equipment-report.csv')
  }

  return (
    <ModuleReportsPage
      moduleKey="equipment"
      subtitle="Defect and inspection picture across every equipment class, for the sites you can see."
      onExport={onExport}
    >
      <IncompleteNotice incomplete={incomplete} className="mb-5" />
      <EquipmentTab
        extinguishers={extinguishers}
        aeds={aeds}
        fas={fas}
        stretchers={stretchers}
        firstAid={firstAid}
        sites={siteInventory}
        keepUnplaced={isAdmin}
      />
    </ModuleReportsPage>
  )
}
