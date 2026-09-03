import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Flame, HeartPulse, BellRing, Signpost, Plus } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import AEDDashboard from './pages/AEDDashboard'
import FASDashboard from './pages/FASDashboard'
import SignageDashboard from './pages/SignageDashboard'

// One dashboard for all emergency equipment — each type in its own tab, keeping
// the existing per-equipment dashboard designs. Signage sits beside them: its
// records live in the Repository, but its compliance reads like the rest.
const TABS = [
  { key: 'ext', label: 'Extinguishers', icon: Flame, Comp: Dashboard },
  { key: 'aed', label: 'AED', icon: HeartPulse, Comp: AEDDashboard },
  { key: 'fas', label: 'Fire Alarm', icon: BellRing, Comp: FASDashboard },
  { key: 'signage', label: 'Signage', icon: Signpost, Comp: SignageDashboard },
]

export default function EquipmentHub() {
  const [tab, setTab] = useState('ext')
  const Active = (TABS.find((t) => t.key === tab) || TABS[0]).Comp

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-1.5 border-b border-ink-100 pb-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={[
              'inline-flex items-center gap-2 rounded-2xl px-3.5 py-2 text-sm font-medium transition-all duration-200 ease-emil',
              tab === t.key
                ? 'bg-clay-surface text-ink-900 shadow-clay-pressed'
                : 'text-ink-500 hover:bg-clay-100 hover:text-ink-800 active:scale-[0.98]',
            ].join(' ')}
          >
            <t.icon size={16} /> {t.label}
          </button>
        ))}
        <Link to="/equipment/add" className="btn-primary ml-auto !py-1.5 text-xs">
          <Plus size={14} /> Add extinguisher
        </Link>
      </div>

      <Active />
    </div>
  )
}
