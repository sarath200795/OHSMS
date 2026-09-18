import { useEffect, useState } from 'react'
import { useAuth } from '../../../shared/auth/AuthContext'
import { toCsv } from '../../../shared/lib/csv'
import { downloadText } from '../../../shared/lib/download'
import ModuleReportsPage from '../../../shared/reports/ModuleReportsPage'
import CommitteeTab from '../../../pages/analytics/CommitteeTab'
import { useAccessibleSites } from '../../../shared/org/useAccessibleSites'
import { subscribeConsultations } from '../lib/firestore'

const COLUMNS = [
  { key: 'docId', label: 'ID' },
  { key: 'type', label: 'Type' },
  { key: 'site', label: 'Site' },
  { key: 'date', label: 'Date' },
  { key: 'status', label: 'Open observations' },
]

export default function Reports() {
  const { orgId, isAdmin } = useAuth()
  const sites = useAccessibleSites()
  const [consultations, setConsultations] = useState([])

  useEffect(() => {
    if (!orgId) return undefined
    return subscribeConsultations(orgId, setConsultations)
  }, [orgId])

  const onExport = () => {
    const rows = (consultations || []).map((c) => ({
      docId: c.docId || c.id || '',
      type: c.type || '',
      site: c.siteName || c.siteId || '',
      date: c.date || '',
      status: (c.observations || c.actions || []).filter((o) => o.status && o.status !== 'Closed')
        .length,
    }))
    downloadText(toCsv(rows, COLUMNS), 'committee-report.csv')
  }

  return (
    <ModuleReportsPage
      moduleKey="committee"
      subtitle="HSE committee meetings and observations for the sites you can see. Same figures as Analytics → HSE Committee."
      onExport={onExport}
    >
      <CommitteeTab consultations={consultations} sites={sites} keepUnplaced={isAdmin} />
    </ModuleReportsPage>
  )
}
