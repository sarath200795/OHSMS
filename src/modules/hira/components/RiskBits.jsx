import { MATRIX_CELLS, PROBABILITY, SEVERITY, riskLevel } from '../lib/riskMatrix'

/** Coloured chip showing a risk level (band label + score). */
export function RiskBadge({ risk, size = 'md' }) {
  if (!risk) return <span className="text-xs text-ink-400">—</span>
  const pad = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-bold text-white ${pad}`}
      style={{ backgroundColor: risk.color }}
      title={risk.guidance}
    >
      {risk.label}
      <span className="rounded-full bg-white/25 px-1.5 text-[10px] font-extrabold">{risk.score}</span>
    </span>
  )
}

/**
 * Compact 5×5 risk matrix. Highlights the cell for the given probability ×
 * severity. Rows = severity (high→low), cols = probability (low→high).
 */
export function MiniMatrix({ probability, severity, className = '' }) {
  const p = Number(probability) || 0
  const s = Number(severity) || 0
  return (
    <div className={`inline-block ${className}`}>
      <div className="flex">
        {/* Severity axis label */}
        <div className="flex items-center">
          <span className="rotate-180 text-[9px] font-bold uppercase tracking-wide text-ink-400 [writing-mode:vertical-rl]">
            Severity →
          </span>
        </div>
        <div>
          <div className="grid grid-cols-5 gap-1">
            {MATRIX_CELLS.flat().map((cell) => {
              const active = cell.probability === p && cell.severity === s
              return (
                <div
                  key={`${cell.probability}-${cell.severity}`}
                  className={`grid h-7 w-7 place-items-center rounded-md text-[10px] font-bold text-white transition ${active ? 'ring-2 ring-ink-900 ring-offset-1 scale-110' : 'opacity-70'}`}
                  style={{ backgroundColor: cell.color }}
                  title={`P${cell.probability} × S${cell.severity} = ${cell.score} · ${cell.label}`}
                >
                  {cell.score}
                </div>
              )
            })}
          </div>
          <div className="mt-1 text-center text-[9px] font-bold uppercase tracking-wide text-ink-400">
            Probability →
          </div>
        </div>
      </div>
    </div>
  )
}

export { riskLevel, PROBABILITY, SEVERITY }
