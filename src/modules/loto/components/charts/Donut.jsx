// Lightweight SVG donut chart with a legend. data: [{ label, value, color }].
export default function Donut({ data = [], size = 168, thickness = 22, centerTop, centerSub }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const r = (size - thickness) / 2
  const C = 2 * Math.PI * r
  let offset = 0

  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e7ddd3" strokeWidth={thickness} />
          {total > 0 &&
            data.map((d, i) => {
              if (!d.value) return null
              const len = (d.value / total) * C
              const el = (
                <circle
                  key={i}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={d.color}
                  strokeWidth={thickness}
                  strokeDasharray={`${len} ${C - len}`}
                  strokeDashoffset={-offset}
                />
              )
              offset += len
              return el
            })}
        </g>
        <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" fill="#1d1b17" fontSize={size * 0.22} fontWeight="800">
          {centerTop ?? total}
        </text>
        {centerSub && (
          <text x="50%" y="62%" textAnchor="middle" dominantBaseline="middle" fill="#8a857a" fontSize={size * 0.08}>
            {centerSub}
          </text>
        )}
      </svg>

      <ul className="min-w-0 flex-1 space-y-1.5">
        {data.map((d, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
            <span className="truncate text-steel-300">{d.label}</span>
            <span className="ml-auto font-semibold text-steel-100">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
