export default function StatCard({ label, value, icon: Icon, tone = 'brand', hint }) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-rose-50 text-rose-600',
    slate: 'bg-slate-100 text-slate-600',
  }
  return (
    <div className="card flex items-center gap-4 p-5">
      {Icon && (
        <span className={`grid h-12 w-12 place-items-center rounded-xl ${tones[tone]}`}>
          <Icon className="h-6 w-6" />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          {label}
        </p>
        <p className="mt-0.5 text-2xl font-extrabold text-ink-800">{value}</p>
        {hint && <p className="text-xs text-slate-400">{hint}</p>}
      </div>
    </div>
  )
}
