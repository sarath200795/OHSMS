import { useState } from 'react'
import { Flame, HeartPulse, BellRing, SignpostBig, Ambulance, BriefcaseMedical } from 'lucide-react'
import Repository from './pages/Repository'
import AEDRepository from './pages/AEDRepository'
import FASRepository from './pages/FASRepository'
import Signages from './pages/Signages'
import Stretchers from './pages/Stretchers'
import FirstAid from './pages/FirstAid'

// One consolidated repository for every emergency-equipment class. Each type
// keeps its own full list/management view, surfaced as a tab.
const TABS = [
  { key: 'ext', label: 'Extinguishers', icon: Flame, Comp: Repository },
  { key: 'aed', label: 'AED', icon: HeartPulse, Comp: AEDRepository },
  { key: 'fas', label: 'Fire Alarm', icon: BellRing, Comp: FASRepository },
  { key: 'sign', label: 'Signages', icon: SignpostBig, Comp: Signages },
  { key: 'stretcher', label: 'Stretchers', icon: Ambulance, Comp: Stretchers },
  { key: 'firstaid', label: 'First Aid', icon: BriefcaseMedical, Comp: FirstAid },
]

export default function EquipmentRepository() {
  const [tab, setTab] = useState('ext')
  const Active = (TABS.find((t) => t.key === tab) || TABS[0]).Comp

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-1 border-b border-ink-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`nav-tab ${tab === t.key ? 'nav-tab-active -mb-px rounded-b-none border-b-2 border-brand-600' : 'nav-tab-idle'}`}
          >
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      <Active />
    </div>
  )
}
