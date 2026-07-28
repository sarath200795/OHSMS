import { useMemo } from 'react'
import { Check } from 'lucide-react'

/** Searchable employee chip picker. Renders at most MAX_CHIPS matches so it
 *  stays responsive with thousands of employees — refine the search to narrow;
 *  selected chips always show. */
const MAX_CHIPS = 60

export default function EmployeeChips({ users, picked, onToggle, search, setSearch, label }) {
  const { shown, hidden } = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matches = q ? users.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q)) : users
    const selected = users.filter((u) => picked.includes(u.uid))
    const rest = matches.filter((u) => !picked.includes(u.uid))
    const capped = rest.slice(0, Math.max(0, MAX_CHIPS - selected.length))
    return { shown: [...selected, ...capped], hidden: Math.max(0, rest.length - capped.length) }
  }, [users, search, picked])

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <label className="label !mb-0">{label} ({picked.length} selected)</label>
        {users.length > 6 && (
          <input className="input !w-52 !py-1.5 !text-xs" placeholder="Search employees…" value={search}
            onChange={(e) => setSearch(e.target.value)} />
        )}
      </div>
      <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-2xl bg-clay-surface p-2.5 shadow-clay-inset">
        {shown.map((u) => {
          const sel = picked.includes(u.uid)
          return (
            <button key={u.uid} type="button" onClick={() => onToggle(u.uid)}
              className={`chip transition ${sel ? 'bg-brand-500 text-white shadow-clay-brand' : 'bg-clay-surface text-ink-600 shadow-clay-sm'}`}>
              {sel && <Check size={12} />}{u.name || u.email}
            </button>
          )
        })}
        {shown.length === 0 && <span className="px-1 text-xs italic text-ink-400">No employees match.</span>}
        {hidden > 0 && (
          <span className="px-1 py-1 text-xs italic text-ink-400">+{hidden} more — refine the search to narrow.</span>
        )}
      </div>
    </div>
  )
}
