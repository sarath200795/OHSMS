import { useState } from 'react'
import { Link } from 'react-router-dom'
import { SlidersHorizontal, Check, X, RotateCcw, CloudSun } from 'lucide-react'
import { Raised, SectionLabel } from '../ui'
import { WIDGET_BY_KEY, DEFAULT_WIDGETS, widgetsByGroup } from './catalog'
import { useAllSiteWeather } from '../../../modules/weather/lib/useAllSiteWeather'
import { BAND_LABEL, levelOf, summariseHazards } from '../../../modules/weather/lib/weatherRisk'

/**
 * The stats this person chose, and the control to change them.
 *
 * A widget renders its own "not yet" state rather than a zero: "no defective
 * extinguishers" and "the extinguishers have not loaded" look identical as a
 * figure, and only one of them is good news.
 */
export default function WidgetGrid({ keys, onSave, data, sites }) {
  const [picking, setPicking] = useState(false)

  return (
    <>
      <div className="mb-3 flex items-end justify-between gap-3">
        <SectionLabel className="mb-0">How are my sites doing?</SectionLabel>
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[12px] font-semibold text-ink-500 transition hover:bg-clay-100 hover:text-ink-800"
        >
          <SlidersHorizontal size={13} /> Choose widgets
        </button>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {keys.map((key) => {
          const w = WIDGET_BY_KEY[key]
          if (!w) return null
          return w.kind === 'weather'
            ? <WeatherWidget key={key} w={w} sites={sites} />
            : <CountWidget key={key} w={w} data={data} />
        })}
      </div>

      {picking && (
        <WidgetPicker
          selected={keys}
          onClose={() => setPicking(false)}
          onSave={(next) => { onSave(next); setPicking(false) }}
        />
      )}
    </>
  )
}

function Shell({ w, children }) {
  return (
    <Raised as={Link} to={w.to} className="block p-4 transition-transform duration-200 ease-emil hover:-translate-y-0.5">
      {children}
    </Raised>
  )
}

function CountWidget({ w, data }) {
  const value = w.value(data)
  const loading = value === null
  // Only where the widget says a non-zero figure is a problem — a count of
  // extinguishers is not bad news for being large.
  const alert = !loading && w.alertWhenAbove != null && value > w.alertWhenAbove

  return (
    <Shell w={w}>
      <span className="grid h-9 w-9 place-items-center rounded-xl text-white" style={{ background: w.tone }}>
        <w.icon size={17} strokeWidth={2.2} />
      </span>
      <p className={`mt-3 text-[26px] font-extrabold leading-none tracking-[-0.03em] ${alert ? 'text-red-600' : 'text-ink-900'}`}>
        {loading ? <span className="text-ink-300">—</span> : value}
      </p>
      <p className="mt-1.5 text-[12px] font-semibold leading-snug text-ink-700">{w.label}</p>
      <p className="text-[11px] text-ink-400">{w.hint}</p>
    </Shell>
  )
}

const BAND_TONE = { none: '#16a34a', low: '#eab308', moderate: '#f97316', high: '#ef4444', severe: '#7f1d1d' }

/**
 * The weather across the viewer's sites: how bad it is, and what kind.
 *
 * A count would be meaningless here, so the headline is the worst band and
 * beneath it every category present, each at its own worst band and carrying
 * the number of sites showing it. The same reading the weather module gives, so
 * the tile and the page cannot disagree.
 */
function WeatherWidget({ w, sites = [] }) {
  const located = sites.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
  const { byId, done, total } = useAllSiteWeather(located)

  let worst = null
  for (const s of located) {
    const r = byId[s.id]
    if (!r) continue
    if (!worst || levelOf(r.risk.band) > levelOf(worst.risk.band)) worst = { site: s, risk: r.risk }
  }

  // Which kinds of weather are a problem, not just how bad the worst one is.
  // Three sites in high wind and one in a thunderstorm is a different morning
  // from four sites baking, and the band alone cannot tell them apart.
  const categories = summariseHazards(located.map((s) => byId[s.id]?.risk).filter(Boolean))

  const band = worst?.risk.band || 'none'
  const waiting = done < total && !worst

  return (
    <Shell w={w}>
      <span className="grid h-9 w-9 place-items-center rounded-xl text-white" style={{ background: BAND_TONE[band] }}>
        <CloudSun size={17} strokeWidth={2.2} />
      </span>
      <p className="mt-3 text-[17px] font-extrabold leading-tight tracking-[-0.02em] text-ink-900">
        {located.length === 0 ? 'No mapped sites' : waiting ? <span className="text-ink-300">Checking…</span> : BAND_LABEL[band]}
      </p>
      <p className="mt-1.5 text-[12px] font-semibold leading-snug text-ink-700">{w.label}</p>

      {categories.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {categories.map((h) => (
            <span
              key={h.key}
              title={`${h.label} at ${h.sites} site${h.sites === 1 ? '' : 's'}`}
              className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10px] font-bold"
              style={{ background: `${BAND_TONE[h.band]}1f`, color: BAND_TONE[h.band] }}
            >
              {h.label}
              {/* The count only earns its space once more than one site shows it. */}
              {h.sites > 1 && <span className="opacity-70">{h.sites}</span>}
            </span>
          ))}
        </div>
      ) : (
        <p className="truncate text-[11px] text-ink-400">
          {located.length === 0 ? 'Add coordinates to a site' : waiting ? w.hint : 'Nothing restricting outdoor work'}
        </p>
      )}
    </Shell>
  )
}

/** The picker. Selection order is preserved, so the grid reads how it was built. */
function WidgetPicker({ selected, onClose, onSave }) {
  const [chosen, setChosen] = useState(selected)

  const toggle = (key) =>
    setChosen((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-3xl bg-clay-bg p-6 shadow-clay-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold tracking-[-0.02em] text-ink-900">Choose your widgets</h2>
            <p className="text-[13px] text-ink-500">
              Pick the figures you want on your portal. Everything stays scoped to the sites you can see.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-1.5 text-ink-400 hover:bg-clay-100">
            <X size={18} />
          </button>
        </div>

        {widgetsByGroup().map(({ group, items }) => (
          <div key={group} className="mb-4">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-400">{group}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {items.map((w) => {
                const on = chosen.includes(w.key)
                return (
                  <button
                    key={w.key}
                    type="button"
                    onClick={() => toggle(w.key)}
                    aria-pressed={on}
                    className={`flex items-start gap-2.5 rounded-2xl px-3 py-2.5 text-left transition ${
                      on ? 'bg-clay-surface shadow-clay-sm' : 'hover:bg-clay-100'
                    }`}
                  >
                    <span
                      className={`mt-0.5 grid h-4 w-4 flex-none place-items-center rounded-[5px] ${
                        on ? 'text-white' : 'border border-ink-200'
                      }`}
                      style={on ? { background: w.tone } : undefined}
                    >
                      {on && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-800">
                        <w.icon size={13} style={{ color: w.tone }} /> {w.label}
                      </span>
                      <span className="block text-[11px] leading-snug text-ink-400">{w.hint}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setChosen([...DEFAULT_WIDGETS])}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink-500 hover:text-ink-800"
          >
            <RotateCcw size={13} /> Reset to default
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-2xl px-4 py-2.5 text-[13px] font-semibold text-ink-600 hover:bg-clay-100">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSave(chosen)}
              className="rounded-2xl bg-brand-600 px-4 py-2.5 text-[13px] font-semibold text-white shadow-clay-brand transition active:scale-[0.98]"
            >
              {chosen.length ? `Show ${chosen.length} widget${chosen.length === 1 ? '' : 's'}` : 'Reset to default'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
