// One filter row of toggle chips (mirrors the Repository/Dashboard ListFilters
// style). Used by the Signage register and the Signage Compliance dashboard.
export default function ChipRow({ label, options, selected, onToggle }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
      <span className="w-20 shrink-0 text-xs font-bold uppercase tracking-wide text-ink-400">{label}</span>
      {options.map((opt) => {
        const on = selected.includes(opt)
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className={`chip transition ${on ? 'bg-brand-500 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'}`}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}
