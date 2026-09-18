import { useAuth } from '../../../shared/auth/AuthContext'
import { toCsv } from '../../../shared/lib/csv'
import { downloadText } from '../../../shared/lib/download'
import { incompleteReadNotice } from '../../../shared/org/orgData'
import ModuleReportsPage from '../../../shared/reports/ModuleReportsPage'
import IncompleteNotice from '../../../shared/ui/IncompleteNotice'
import IncidentsTab from '../../../pages/analytics/IncidentsTab'
import { INCIDENT_TYPE_BY_KEY } from '../lib/constants'
import { useIncidents } from '../context/IncidentContext'

const COLUMNS = [
  { key: 'docId', label: 'ID' },
  { key: 'type', label: 'Type' },
  { key: 'category', label: 'Category' },
  { key: 'severity', label: 'Severity' },
  { key: 'site', label: 'Site' },
  { key: 'incidentDate', label: 'Date' },
  { key: 'status', label: 'Status' },
]

export default function Reports() {
  const { isAdmin } = useAuth()
  const { incidents, sites, capped, loadCap } = useIncidents()

  const onExport = () => {
    const rows = incidents.map((i) => ({
      docId: i.docId || i.id || '',
      type: INCIDENT_TYPE_BY_KEY[i.type]?.label || i.type || '',
      category: i.category || '',
      severity: i.severity || '',
      site: i.site || i.location || '',
      incidentDate: i.incidentDate || '',
      status: i.status || '',
    }))
    downloadText(toCsv(rows, COLUMNS), 'incidents-report.csv')
  }

  return (
    <ModuleReportsPage
      moduleKey="incidents"
      subtitle="Incident counts, trend and breakdowns for the sites you can see. Same figures as Analytics → Incidents."
      onExport={onExport}
    >
      <IncompleteNotice
        incomplete={capped ? incompleteReadNotice({ incidents: 'capped' }, loadCap) : null}
        className="mb-5"
      />
      <IncidentsTab incidents={incidents} sites={sites} keepUnplaced={isAdmin} />
    </ModuleReportsPage>
  )
}
