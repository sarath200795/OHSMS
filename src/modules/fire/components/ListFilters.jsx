import { Search, Filter, X } from 'lucide-react'
import { TYPES, CAPACITIES, ENTITIES, REGIONS, STATUS, STATUS_LABEL, PHYSICAL_DEFECT_KEYS, DEFECT_BY_KEY } from '../lib/constants'
import { emptyFilters, hasActiveFilters } from '../lib/listFilter'

// field key → { label, options: [{ value, label }] }
const FIELD_DEFS = {
  type: { label: 'Type', options: TYPES.map((v) => ({ value: v, label: v })) },
  capacity: { label: 'Capacity', options: CAPACITIES.map((v) => ({ value: v, label: v })) },
  entity: { label: 'Entity', options: ENTITIES.map((v) => ({ value: v, label: v })) },
  region: { label: 'Region', options: REGIONS.map((v) => ({ value: v, label: v })) },
  status: { label: 'Status', options: Object.values(STATUS).map((s) => ({ value: s, label: STATUS_LABEL[s] })) },
  defect: { label: 'Defect', options: PHYSICAL_DEFECT_KEYS.map((k) => ({ value: k, label: DEFECT_BY_KEY[k].label })) },
}

/**
 * Reusable client-side filter bar. Each attribute field is a row of toggle
 * chips — selecting multiple in a field is OR; across fields is AND. Empty
 * field = no constraint.
 *
 * Props:
 *  - filters / onChange(next): the filter object (see lib/listFilter emptyFilters)
 *  - fields: attribute fields to show (default type/capacity/entity/region)
 *  - showStatus / showDefect: append those fields
 *  - searchPlaceholder
 *  - children: extra controls (e.g. Repository's condition chips)
 */
export default function ListFilters({
  filters,
  onChange,
  fields = ['type', 'capacity', 'entity', 'region'],
  showStatus = false,
  showDefect = false,
  searchPlaceholder = 'Search serial, center or type…',
  children,
}) {
  const activeFields = [
    ...(showDefect ? ['defect'] : []),
    ...fields,
    ...(showStatus ? ['status'] : []),
  ]

  const toggle = (key, value) => {
    const cur = Array.isArray(filters[key]) ? filters[key] : []
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]
    onChange({ ...filters, [key]: next })
  }
  const clear = () => onChange(emptyFilters())

  return (
    <div className="card mb-4 space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-ink-400">
          <Filter size={13} /> Filters
        </span>
        <div className="relative min-w-[200px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            className="input pl-9"
            placeholder={searchPlaceholder}
            value={filters.search || ''}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
          />
        </div>
        {hasActiveFilters(filters) && (
          <button className="btn-ghost" onClick={clear}><X size={15} /> Clear</button>
        )}
      </div>

      {activeFields.map((key) => {
        const def = FIELD_DEFS[key]
        const selected = Array.isArray(filters[key]) ? filters[key] : []
        return (
          <div key={key} className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
            <span className="w-16 shrink-0 text-xs font-bold uppercase tracking-wide text-ink-400">{def.label}</span>
            {def.options.map((opt) => {
              const on = selected.includes(opt.value)
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggle(key, opt.value)}
                  className={`chip transition ${on ? 'bg-brand-500 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'}`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        )
      })}

      {children}
    </div>
  )
}
