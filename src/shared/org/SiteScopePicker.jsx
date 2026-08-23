import { useId, useMemo } from 'react'
import { useAuth } from '../auth/AuthContext'
import { moduleLevels, defaultLevels, siteLevelValue, distinctSiteValues, SITE_LEVEL_KEY } from './scopeConfig'

// Correlated, permission-filtered scope selector. The set of levels is driven by
// the org's per-module granularity config: pass `module="incidents"` to use that
// module's configured levels, or pass an explicit `levels` array. With neither it
// falls back to the built-in Region → Entity → Site.
//
// Each earlier selection narrows the later dropdowns; picking the final Site
// auto-fills every earlier level from that site's data. `value` is a flat map
// keyed by each level key, plus `siteId` (+ `site` = the chosen site's name).
// Uses the global .input / .label classes so it drops into any module/form.
export default function SiteScopePicker({
  sites = [],
  value = {},
  onChange,
  disabled = false,
  cols = 3,
  levels: levelsProp,
  module: moduleKey,
}) {
  const { org } = useAuth()

  // One prefix per mounted picker, suffixed by level key. These labels sat
  // beside their selects with nothing joining them, and because the label text
  // is an expression — {lv.label} — no static rule reports it, so it survived
  // every lint pass. This component is mounted by six modules, which is how one
  // unattached label became several dozen unnamed dropdowns: a permit form read
  // as "combo box, combo box, combo box" with no way to tell region from site.
  const uid = useId()
  const fieldId = (key) => `${uid}-${key}`

  const levels = useMemo(() => {
    if (levelsProp && levelsProp.length) return levelsProp
    if (moduleKey) return moduleLevels(org, moduleKey)
    return defaultLevels()
  }, [levelsProp, moduleKey, org])

  // Sites still consistent with every selection made in levels before `index`.
  const filteredUpTo = (index) =>
    sites.filter((s) =>
      levels.slice(0, index).every((lv) => {
        const sel = value[lv.key]
        return !sel || siteLevelValue(s, lv.key) === sel
      })
    )

  // Set a grouping level → clear this + every later level (incl. the site leaf).
  const setLevel = (index, val) => {
    const next = { ...value }
    levels.forEach((lv, i) => {
      if (i === index) next[lv.key] = val
      else if (i > index) next[lv.key] = ''
    })
    next.siteId = ''
    if (levels.some((lv) => lv.key === SITE_LEVEL_KEY)) next[SITE_LEVEL_KEY] = ''
    onChange(next)
  }

  // Pick the site leaf → fill siteId + name, and back-fill every earlier level.
  const setSite = (id) => {
    const s = sites.find((x) => x.id === id)
    const next = { ...value, siteId: id, [SITE_LEVEL_KEY]: s?.name || '' }
    if (s) levels.forEach((lv) => { if (lv.key !== SITE_LEVEL_KEY) next[lv.key] = siteLevelValue(s, lv.key) })
    onChange(next)
  }

  // Respect an explicit `cols` (audit uses cols={1} → stacked), capped by how
  // many levels there actually are. Literal class names keep Tailwind JIT happy.
  const perRow = cols === 1 ? 1 : Math.min(cols || 3, Math.max(levels.length, 1))
  const gridCols = perRow >= 3 ? 'sm:grid-cols-3' : perRow === 2 ? 'sm:grid-cols-2' : ''

  return (
    <div className={`grid grid-cols-1 gap-4 ${gridCols}`}>
      {levels.map((lv, i) => {
        if (lv.key === SITE_LEVEL_KEY) {
          const siteList = filteredUpTo(i)
          return (
            <div key={lv.key}>
              <label className="label" htmlFor={fieldId(lv.key)}>{lv.label}</label>
              <select id={fieldId(lv.key)} className="input" disabled={disabled} value={value.siteId || ''} onChange={(e) => setSite(e.target.value)}>
                <option value="">{siteList.length ? 'Select site…' : 'No sites you can access'}</option>
                {siteList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )
        }
        // Predefined values from the granularity settings come first, then any
        // extra values discovered in the site data (narrowed by earlier picks).
        const predefined = lv.options || []
        const siteVals = distinctSiteValues(filteredUpTo(i), lv.key)
        const opts = [...predefined, ...siteVals.filter((v) => !predefined.includes(v))]
        return (
          <div key={lv.key}>
            <label className="label" htmlFor={fieldId(lv.key)}>{lv.label}</label>
            <select id={fieldId(lv.key)} className="input" disabled={disabled} value={value[lv.key] || ''} onChange={(e) => setLevel(i, e.target.value)}>
              <option value="">{opts.length ? `Select ${lv.label.toLowerCase()}…` : `No ${lv.label.toLowerCase()}`}</option>
              {opts.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        )
      })}
    </div>
  )
}
