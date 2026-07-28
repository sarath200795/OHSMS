import { useState } from 'react'
import { Flame, HeartPulse, BellRing, SignpostBig } from 'lucide-react'
import Repository from './pages/Repository'
import AEDRepository from './pages/AEDRepository'
import FASRepository from './pages/FASRepository'
import Signages from './pages/Signages'

// One consolidated repository for every emergency-equipment class. Each type
// keeps its own full list/management view, surfaced as a tab.
const TABS = [
  { key: 'ext', label: 'Extinguishers', icon: Flame, Comp: Repository },
  { key: 'aed', label: 'AED', icon: HeartPulse, Comp: AEDRepository },
  { key: 'fas', label: 'Fire Alarm', icon: BellRing, Comp: FASRepository },
  { key: 'sign', label: 'Signages', icon: SignpostBig, Comp: Signages },
]

export default function EquipmentRepository() {
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
      </div>

      <Active />
    </div>
  )
}
