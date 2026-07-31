import { Picker } from './ui'

/**
 * Site / region / entity / month-range, shared by every tab.
 *
 * The options come from every visible record rather than the filtered set:
 * choices that disappear as you use them make a filter bar impossible to reason
 * about, because narrowing one dimension silently removes the way back.
 */
export default function FilterBar({ f, setF, sites = [], opts, idPrefix = 'flt' }) {
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))
  const reset = () => setF({ siteId: 'all', region: 'all', entity: 'all', from: '', to: '' })

  return (
    <div className="card mb-5 flex flex-wrap items-end gap-3 p-4">
      <Picker id={`${idPrefix}-site`} label="Site" value={f.siteId} onChange={set('siteId')}>
        <option value="all">All sites ({sites.length})</option>
        {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Picker>
      <Picker id={`${idPrefix}-region`} label="Region" value={f.region} onChange={set('region')}>
        <option value="all">All regions</option>
        {opts.regions.map((r) => <option key={r} value={r}>{r}</option>)}
      </Picker>
      <Picker id={`${idPrefix}-entity`} label="Entity" value={f.entity} onChange={set('entity')}>
        <option value="all">All entities</option>
        {opts.entities.map((r) => <option key={r} value={r}>{r}</option>)}
      </Picker>
      <Picker id={`${idPrefix}-from`} label="From" value={f.from} onChange={set('from')}>
        <option value="">Earliest</option>
        {opts.months.map((m) => <option key={m} value={m}>{m}</option>)}
      </Picker>
      <Picker id={`${idPrefix}-to`} label="To" value={f.to} onChange={set('to')}>
        <option value="">Latest</option>
        {opts.months.map((m) => <option key={m} value={m}>{m}</option>)}
      </Picker>
      <button
        type="button"
        onClick={reset}
        className="rounded-2xl bg-clay-surface px-4 py-2.5 text-[12.5px] font-semibold text-ink-700 shadow-clay-sm"
      >
        Reset
      </button>
    </div>
  )
}
