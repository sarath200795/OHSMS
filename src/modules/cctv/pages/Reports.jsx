import { useAuth } from '../../../shared/auth/AuthContext'
import { toCsv } from '../../../shared/lib/csv'
import { downloadText } from '../../../shared/lib/download'
import ModuleReportsPage from '../../../shared/reports/ModuleReportsPage'
import CctvTab from '../../../pages/analytics/CctvTab'
import { useCctv } from '../context/CctvContext'

const COLUMNS = [
  { key: 'kind', label: 'Kind' },
  { key: 'name', label: 'Name' },
  { key: 'site', label: 'Site' },
  { key: 'status', label: 'Status' },
]

export default function Reports() {
  const { isAdmin } = useAuth()
  const { cameras, dvrs, merakis, sites } = useCctv()

  const onExport = () => {
    const row = (kind, d) => ({
      kind,
      name: d.name || d.code || d.id || '',
      site: d.siteName || d.siteId || '',
      status: d.status || d.health || '',
    })
    const rows = [
      ...(cameras || []).map((d) => row('Camera', d)),
      ...(dvrs || []).map((d) => row('DVR', d)),
      ...(merakis || []).map((d) => row('Meraki', d)),
    ]
    downloadText(toCsv(rows, COLUMNS), 'cctv-report.csv')
  }

  return (
    <ModuleReportsPage
      moduleKey="cctv"
      subtitle="Root-cause defects after the cascade — a dead switch is one finding, not forty cameras. Same figures as Analytics → CCTV."
      onExport={onExport}
    >
      <CctvTab
        cameras={cameras}
        dvrs={dvrs}
        merakis={merakis}
        sites={sites}
        keepUnplaced={isAdmin}
      />
    </ModuleReportsPage>
  )
}
