import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, CheckCircle2, Repeat } from 'lucide-react'
import { PageHeader } from '../components/ui'
import SiteFilter from '../components/SiteFilter'
import { useData } from '../context/DataContext'
import { formatDateOnly } from '../lib/schedule'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function Schedule() {
  const navigate = useNavigate()
  const { scheduledTasks, records, currentMonth, setCurrentMonth } = useData()

  const todayString = formatDateOnly(new Date())
  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDow = new Date(year, month, 1).getDay()

  const completedByDay = useMemo(() => {
    const map = new Map()
    records.forEach((r) => {
      if (!r.completedAt) return
      const day = String(r.completedAt).slice(0, 10)
      if (!map.has(day)) map.set(day, [])
      map.get(day).push(r)
    })
    return map
  }, [records])

  const startInspection = (task) => {
    navigate('/inspections/execute', { state: { task: { ...task, dueDate: undefined } } })
  }

  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(<div key={`e-${i}`} className="min-h-[110px] rounded-xl bg-clay-surface/40" />)

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const isToday = dateStr === todayString
    const tasksToday = scheduledTasks.filter((t) => t.dueString === dateStr)
    const doneToday = completedByDay.get(dateStr) || []

    cells.push(
      <div key={day} className={`flex min-h-[110px] flex-col rounded-xl p-2 shadow-clay-inset ${isToday ? 'bg-brand-50 ring-2 ring-brand-300' : 'bg-clay-surface'}`}>
        <div className={`mb-1 text-right text-xs font-bold ${isToday ? 'text-brand-600' : 'text-ink-400'}`}>{day}</div>
        <div className="flex-1 space-y-1 overflow-y-auto custom-scroll pr-0.5">
          {doneToday.map((r) => (
            <button key={r.id} onClick={() => navigate('/inspections/records', { state: { recordId: r.id } })}
              className={`block w-full truncate rounded px-1.5 py-1 text-left text-[10px] font-bold text-white ${r.passFailResult === 'PASS' ? 'bg-emerald-500' : 'bg-red-500'}`}
              title={`${r.templateTitle} — ${r.score}% (${r.passFailResult})`}>
              <CheckCircle2 size={10} className="mr-0.5 inline" />{r.templateTitle} · {r.score}%
            </button>
          ))}
          {tasksToday.map((t, idx) => {
            const overdue = dateStr < todayString
            const dueWindow = todayString >= t.alertStartString
            const place = t.siteName || t.location || ''
            return (
              <button key={`${t.templateId}-${t.assignmentId || ''}-${idx}`} onClick={() => startInspection(t)}
                className={`block w-full truncate rounded px-1.5 py-1 text-left text-[10px] font-bold transition hover:brightness-105 ${overdue || dueWindow ? 'bg-red-500 text-white' : 'bg-brand-500 text-white'}`}
                title={`${t.title}${place ? ' · ' + place : ''} · due ${t.dueString}`}>
                {t.frequency && t.frequency !== 'One-off' && <Repeat size={9} className="mr-0.5 inline" />}
                {t.title}
                {place && <span className="block truncate font-normal opacity-80"><MapPin size={8} className="mr-0.5 inline" />{place}</span>}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader icon={CalendarDays} title="Schedule" subtitle="Pending inspections (click a tile to start) and completed records">
        <div className="flex flex-wrap items-center gap-2">
          <SiteFilter />
          <button className="btn-ghost p-2" onClick={() => setCurrentMonth(new Date(year, month - 1, 1))}><ChevronLeft size={18} /></button>
          <span className="min-w-[150px] text-center font-bold text-ink-800">{MONTHS[month]} {year}</span>
          <button className="btn-ghost p-2" onClick={() => setCurrentMonth(new Date(year, month + 1, 1))}><ChevronRight size={18} /></button>
          <button className="btn-soft text-xs" onClick={() => setCurrentMonth(new Date())}>Today</button>
        </div>
      </PageHeader>

      <div className="card p-4">
        <div className="mb-2 grid grid-cols-7 gap-2">
          {DOW.map((d) => <div key={d} className="text-center text-[10px] font-bold uppercase tracking-widest text-ink-400">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-2">{cells}</div>
      </div>

      <div className="mt-4 flex flex-wrap gap-4 text-xs text-ink-500">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-brand-500" /> Due / upcoming</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-red-500" /> Due window / overdue</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-emerald-500" /> Completed (pass)</span>
      </div>
    </div>
  )
}
