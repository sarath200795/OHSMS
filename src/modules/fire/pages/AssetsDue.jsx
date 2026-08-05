import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { BellRing, Flame, HeartPulse, ArrowRight, ShieldCheck } from 'lucide-react'
import { PageHeader, EmptyState, Spinner, Badge } from '../components/ui'
import { useFleet } from '../context/FleetContext'
import { toDate } from '../lib/extinguisherLogic'
import { dueState, aedCondition, fasCondition } from '../lib/assetLogic'
import { AED_STATUS_LABEL, FAS_STATUS_LABEL } from '../lib/constants'

const fmt = (v) => { const d = toDate(v); return d ? format(d, 'dd MMM yyyy') : '—' }
const dueTag = (s) => (s === 'expired' ? 'overdue' : s === 'due' ? 'due soon' : null)

function Section({ icon: Icon, title, color, count, to, cta, cols, rows, empty }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-clay-200/60 px-4 py-3">
        <div className="grid h-9 w-9 place-items-center rounded-xl text-white" style={{ backgroundColor: color }}><Icon size={18} /></div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-ink-900">{title}</p>
          <p className="text-xs text-ink-500">{count} need attention</p>
        </div>
        <Link to={to} className="btn-soft px-3 py-1.5 text-xs">{cta} <ArrowRight size={14} /></Link>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-ink-400">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-clay-100/60 text-left text-[11px] uppercase tracking-wide text-ink-400">
              <tr>{cols.map((c) => <th key={c} className="px-4 py-2">{c}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-clay-200/60">{rows}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function AssetsDue() {
  const { refillDue, physicalDefects, aeds, fas, loading } = useFleet()
  const today = useMemo(() => new Date(), [])

  // Extinguishers needing attention: refill-due + physical defects (deduped).
  const extRows = useMemo(() => {
    const seen = new Set()
    const items = []
    for (const e of [...(refillDue || []), ...(physicalDefects || [])]) {
      if (seen.has(e.id)) continue
      seen.add(e.id); items.push(e)
    }
    return items
  }, [refillDue, physicalDefects])

  const aedDue = useMemo(() => (aeds || []).filter((a) => { const c = aedCondition(a, today); return c.due || c.expired }), [aeds, today])
  const fasDue = useMemo(() => (fas || []).filter((a) => { const c = fasCondition(a, today); return c.due || c.expired }), [fas, today])

  const aedReason = (a) => {
    const bits = []
    const b = dueTag(dueState(a.batteryExpiry, today)); if (b) bits.push(`Battery ${b}`)
    const p = dueTag(dueState(a.padExpiry, today)); if (p) bits.push(`Pads ${p}`)
    const i = dueTag(dueState(a.nextInspection, today)); if (i) bits.push(`Inspection ${i}`)
    if (a.status === 'out_of_service') bits.push('Out of service')
    return bits.join(' · ') || AED_STATUS_LABEL[a.status] || '—'
  }
  const fasReason = (a) => {
    const bits = []
    const s = dueTag(dueState(a.nextService, today)); if (s) bits.push(`Service ${s}`)
    if (a.status === 'faulty') bits.push('Faulty')
    return bits.join(' · ') || FAS_STATUS_LABEL[a.status] || '—'
  }

  if (loading) return <div className="grid place-items-center py-20"><Spinner size={28} /></div>

  const total = extRows.length + aedDue.length + fasDue.length

  return (
    <div>
      <PageHeader title="Assets Due" subtitle="Everything across extinguishers, AEDs and fire-alarm devices that needs attention." icon={BellRing} />

      {total === 0 ? (
        <EmptyState icon={ShieldCheck} title="All clear 🎉" hint="Nothing is overdue or due soon across your assets." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-1">
          <Section
            icon={Flame} title="Extinguishers" color="#e11d1d" count={extRows.length}
            to="/equipment/refill-due" cta="Repository" cols={['Serial', 'Site', 'Next Refill', 'Next HPT']}
            empty="No extinguishers due."
            rows={extRows.slice(0, 15).map((e) => (
              <tr key={e.id} className="hover:bg-ink-50/70">
                <td className="px-4 py-2.5 font-semibold text-ink-800">{e.serialNo || e.type}</td>
                <td className="px-4 py-2.5 text-ink-600">{e.centerName}</td>
                <td className="px-4 py-2.5">{fmt(e.dateOfNextRefill)}</td>
                <td className="px-4 py-2.5">{fmt(e.dateOfNextHPT)}</td>
              </tr>
            ))}
          />
          <Section
            icon={HeartPulse} title="AEDs" color="#6366f1" count={aedDue.length}
            to="/equipment/aed" cta="Repository" cols={['Asset', 'Site', 'Reason']}
            empty="No AEDs due."
            rows={aedDue.slice(0, 15).map((a) => (
              <tr key={a.id} className="hover:bg-ink-50/70">
                <td className="px-4 py-2.5 font-semibold text-ink-800">{a.assetId || 'AED'}</td>
                <td className="px-4 py-2.5 text-ink-600">{a.centerName}</td>
                <td className="px-4 py-2.5"><Badge color="#f59e0b">{aedReason(a)}</Badge></td>
              </tr>
            ))}
          />
          <Section
            icon={BellRing} title="Fire Alarm (FAS)" color="#0891b2" count={fasDue.length}
            to="/equipment/fas" cta="Repository" cols={['Device', 'Site', 'Reason']}
            empty="No FAS devices due."
            rows={fasDue.slice(0, 15).map((a) => (
              <tr key={a.id} className="hover:bg-ink-50/70">
                <td className="px-4 py-2.5 font-semibold text-ink-800">{a.deviceId || a.deviceType}</td>
                <td className="px-4 py-2.5 text-ink-600">{a.centerName}</td>
                <td className="px-4 py-2.5"><Badge color="#f59e0b">{fasReason(a)}</Badge></td>
              </tr>
            ))}
          />
        </div>
      )}
    </div>
  )
}
