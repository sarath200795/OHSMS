import { AlertTriangle, Stethoscope, HeartPulse, ListChecks, Trash2, BarChart3 } from 'lucide-react'
import { useAuth } from './context/AuthContext'
import ModuleTabs from '../../shared/layout/ModuleTabs'
import { reportsNavTab } from '../../shared/modules/reports'

const TABS = [
  { to: '/incidents', label: 'Incidents', icon: AlertTriangle, end: true },
  { to: '/incidents/illness', label: 'Illnesses', icon: Stethoscope },
  { to: '/incidents/injuries', label: 'Injuries', icon: HeartPulse },
  { to: '/incidents/actions', label: 'Actions', icon: ListChecks },
  { ...reportsNavTab('/incidents'), icon: BarChart3 },
]

// Secondary nav for the Incidents module (the original app's Layout tabs).
export default function ModuleNav() {
  const { isAdmin } = useAuth()
  const tabs = isAdmin
    ? [...TABS, { to: '/incidents/recycle', label: 'Recycle Bin', icon: Trash2 }]
    : TABS
  return <ModuleTabs label="Incidents sections" tabs={tabs} />
}
