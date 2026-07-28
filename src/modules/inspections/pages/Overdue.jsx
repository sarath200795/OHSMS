import { useNavigate } from 'react-router-dom'
import { CalendarClock, MapPin, Play } from 'lucide-react'
import { PageHeader, EmptyState } from '../components/ui'
import SiteFilter from '../components/SiteFilter'
import { useData } from '../context/DataContext'
import { formatDateOnly } from '../lib/schedule'

export default function Overdue() {
  const navigate = useNavigate()
  const { scheduledTasks } = useData()
  const todayString = formatDateOnly(new Date())

  const upcoming = scheduledTasks.filter((t) => t.dueString >= todayString)
  const overdue = scheduledTasks.filter((t) => t.dueString < todayString)

  const start = (task) => navigate('/inspections/execute', { state: { task: { ...task, dueDate: undefined } } })

  const Row = ({ t, late }) => (
    <div className="card flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`font-mono text-sm font-bold ${late ? 'text-red-600' : 'text-brand-700'}`}>{t.dueString}</span>
          <span className="truncate font-semibold text-ink-800">{t.title}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-ink-500">
          <span>{t.frequency}</span>
          {(t.siteName || t.location) && <span className="inline-flex items-center gap-1"><MapPin size={12} /> {t.siteName || t.location}{t.area ? ` · ${t.area}` : ''}</span>}
          {t.assignmentNotes && <span className="italic">"{t.assignmentNotes}"</span>}
        </div>
      </div>
      <button className="btn-primary shrink-0 text-xs" onClick={() => start(t)}><Play size={14} /> Start</button>
    </div>
  )

  return (
    <div>
      <PageHeader icon={CalendarClock} title="Overdue & upcoming" subtitle="Inspections still pending completion">
        <SiteFilter />
      </PageHeader>

      {overdue.length === 0 && upcoming.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Nothing pending" hint="No scheduled inspections are due. Assign forms from the Inspection Forms page." />
      ) : (
        <div className="space-y-6">
          {overdue.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-bold text-red-600">Overdue ({overdue.length})</h3>
              <div className="space-y-2">{overdue.map((t, i) => <Row key={`o-${i}`} t={t} late />)}</div>
            </div>
          )}
          {upcoming.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-bold text-ink-700">Upcoming ({upcoming.length})</h3>
              <div className="space-y-2">{upcoming.map((t, i) => <Row key={`u-${i}`} t={t} />)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
