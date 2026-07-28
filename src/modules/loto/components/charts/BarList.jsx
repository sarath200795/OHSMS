// Horizontal bar list. data: [{ label, value, color }].
export default function BarList({ data = [] }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="space-y-3">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-32 shrink-0 truncate text-xs font-medium text-steel-300">{d.label}</div>
          <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-clay shadow-clay-inset">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${(d.value / max) * 100}%`, background: d.color, minWidth: d.value ? '6px' : 0 }}
            />
          </div>
          <div className="w-7 text-right text-sm font-bold text-steel-100">{d.value}</div>
        </div>
      ))}
    </div>
  )
}
