// ─────────────────────────────────────────────────────────────────────────────
// Analytics → CCTV.
//
// The one rule that matters here: CCTV faults cascade. A dead Meraki darkens
// every DVR at its site, and a dead DVR darkens its cameras. A naive count
// therefore plots one failed switch as forty failed cameras, and a map that
// does that is worse than no map — somebody dispatches forty visits from it and
// the switch stays dead.
//
// None of that is re-derived here. modules/cctv/lib/health.js owns the cascade
// and already separates a device that is BROKEN from one that is merely DARK.
// This tab takes its root-cause defect lists and does one thing to them:
// attributes each to a site so it can be drawn. Coordinates live on the site
// record, never on the device.
//
// The month range is applied for the same reason and in the same order: health
// is computed over the whole estate FIRST, and the range narrows the defect
// lists that come out of it. Narrowing the inputs instead would change what the
// cascade concludes — a DVR dated outside the range would disappear, and the
// cameras it was darkening would turn from casualties into orphans.
// ─────────────────────────────────────────────────────────────────────────────

/* eslint-disable react-refresh/only-export-components --
   the aggregation is exported for CctvTab.test.js, not for other components to
   import; splitting it out would put the tab's own logic in a shared file. */
import { useMemo, useState } from 'react'
import { MapContainer, TileLayer, Marker, Tooltip as LeafletTooltip } from 'react-leaflet'
import L from 'leaflet'
import { Cctv, HardDrive, Router, TriangleAlert, MapPin, Unplug, CalendarClock } from 'lucide-react'
import { Panel, Stat, NoData, Picker } from './ui'
import Breakdown from './Breakdown'
import { monthOf, prettyMonth } from './moduleAnalytics'
import { estateHealth, cameraSummary, dvrSummary } from '../../modules/cctv/lib/health'
import {
  CAUSE, CAMERA_DEFECT_BY_KEY, DVR_DEFECT_BY_KEY, MERAKI_DEFECT_BY_KEY,
} from '../../modules/cctv/lib/constants'

/**
 * The three device kinds, most upstream first.
 *
 * The order is load-bearing: where a site has more than one kind of fault, the
 * pin takes its number colour from the furthest-upstream kind failing there,
 * because that is the one to send someone to first.
 */
const CCTV_KINDS = [
  { key: 'meraki', name: 'Meraki', plural: 'Meraki switches', color: '#c74a33', icon: Router },
  { key: 'dvr', name: 'DVR', plural: 'DVRs', color: '#e8a33d', icon: HardDrive },
  { key: 'camera', name: 'Camera', plural: 'Cameras', color: '#2563eb', icon: Cctv },
]

const FAULT_LABELS = {
  camera: CAMERA_DEFECT_BY_KEY,
  dvr: DVR_DEFECT_BY_KEY,
  meraki: MERAKI_DEFECT_BY_KEY,
}

const rank = (kind) => CCTV_KINDS.findIndex((k) => k.key === kind)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const plural = (n) => (n === 1 ? '' : 's')

/**
 * A fault as a person reads it, always prefixed with the kind.
 *
 * All three kinds have a fault called "Offline" and they mean entirely
 * different jobs. Letting them share a row would merge a switch outage into a
 * camera count — the one thing this module exists to prevent.
 */
export function faultLabel(kind, key) {
  const label = FAULT_LABELS[kind]?.[key]?.label || key
  return `${CCTV_KINDS[rank(kind)]?.name || kind} · ${label}`
}

/** Count rows into named bars, each coloured by the worst kind behind it. */
function group(rows, label) {
  const m = new Map()
  for (const r of rows) {
    const name = label(r) || 'Unassigned'
    const e = m.get(name) || { key: name, name, value: 0, lead: CCTV_KINDS.length }
    e.value += 1
    e.lead = Math.min(e.lead, rank(r.kind))
    m.set(name, e)
  }
  return [...m.values()]
    .map((e) => ({ key: e.key, name: e.name, value: e.value, color: CCTV_KINDS[e.lead]?.color }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
}

/**
 * Everything this tab draws.
 *
 * `keepUnplaced` follows the rest of analytics: a device that resolves to no
 * visible site sits somewhere the viewer is not allowed to see, so only an
 * admin is shown it.
 *
 * `from` / `to` are 'YYYY-MM', '' meaning earliest and latest — the same month
 * range every other tab uses, read off each device's `defectReportedOn`.
 */
export function cctvDefectAnalytics({
  cameras = [], dvrs = [], merakis = [], sites = [],
  siteId = 'all', kind = 'all', from = '', to = '', keepUnplaced = true,
} = {}) {
  // Health is computed over the WHOLE estate and only the results are scoped.
  // Filtering the inputs first would change what the cascade concludes: a
  // camera whose DVR fell outside the filter would stop being "dark because its
  // DVR is down" and become an orphan, so the same camera would have a
  // different explanation depending on which site you happened to pick.
  const estate = estateHealth({ cameras, dvrs, merakis })
  const registry = new Map(sites.filter((s) => s?.id).map((s) => [s.id, s]))

  // Permission and choice, kept apart: `visible` is what this viewer may ever
  // see, `inScope` is what they have currently asked for. The month options are
  // built from the first, so choosing a site cannot remove a month.
  const visible = (at) => keepUnplaced || registry.has(at)
  const inScope = (at) => (siteId === 'all' ? visible(at) : at === siteId)

  // The defect extractors carry the site's name but not its id, and a camera's
  // site may have been inherited from its DVR — so the id comes off the health
  // object, which is the one that resolved it.
  const placedAt = {
    camera: new Map(estate.cameras.map((c) => [c.id, c.siteId])),
    dvr: new Map(estate.dvrs.map((d) => [d.id, d.siteId])),
    meraki: new Map(estate.merakis.map((m) => [m.id, m.siteId])),
  }

  // The report date is on the device record, not on the health object: health.js
  // derives connectivity and has no opinion about when somebody last walked
  // round with a clipboard. A device whose only fault is being offline carries
  // no date at all — the writer clears it with the last stored defect — so an
  // outage is always undated, and an outage can therefore never be ranged out
  // of the map.
  const reportedIn = {
    camera: new Map(cameras.map((c) => [c?.id, monthOf(c?.defectReportedOn)])),
    dvr: new Map(dvrs.map((d) => [d?.id, monthOf(d?.defectReportedOn)])),
    meraki: new Map(merakis.map((m) => [m?.id, monthOf(m?.defectReportedOn)])),
  }

  const everywhere = CCTV_KINDS.flatMap((k) =>
    (estate.defects[k.key] || []).map((d) => {
      const at = placedAt[k.key].get(d.id) || ''
      const site = registry.get(at)
      return {
        kind: k.key,
        id: d.id || '',
        name: d.name || k.name,
        siteId: at,
        // The registry name wins where there is one. The name the device itself
        // recorded is only ever reached for a site outside the viewer's list,
        // which only an admin is shown at all.
        siteName: site?.name || d.siteName || 'Unassigned',
        region: site?.region || 'Unassigned',
        faults: Array.isArray(d.defects) ? d.defects : [],
        cause: d.cause || CAUSE.NONE,
        month: reportedIn[k.key].get(d.id) || '',
      }
    })
  )

  const inRange = (month) => {
    // Undated defects survive the range rather than vanishing, exactly as
    // applyFilters does in moduleAnalytics.js: a missing date is a data-quality
    // problem to surface, not one to hide. It matters more here than anywhere,
    // because every defect raised before this field existed is undated.
    if (!month) return true
    if (from && month < from) return false
    if (to && month > to) return false
    return true
  }

  const scopedRows = everywhere.filter((r) => inScope(r.siteId))
  const all = scopedRows.filter((r) => inRange(r.month))
  const shown = kind === 'all' ? all : all.filter((r) => r.kind === kind)
  // What the range took away from what would otherwise be on screen — the kind
  // filter is applied to both sides so the two numbers are comparable.
  const inKind = (rows) => (kind === 'all' ? rows : rows.filter((r) => r.kind === kind))
  const outOfRange = inKind(scopedRows).length - shown.length

  const scoped = {
    camera: estate.cameras.filter((c) => inScope(c.siteId)),
    dvr: estate.dvrs.filter((d) => inScope(d.siteId)),
    meraki: estate.merakis.filter((m) => inScope(m.siteId)),
  }

  // Casualties — dark, but nothing wrong with them. Counted separately and
  // never plotted, so the distance between "offline" and "faulty" stays visible
  // instead of being quietly folded into the defect count.
  //
  // The month range deliberately does not touch this. Being dark is a fact
  // about right now, not something that was reported on a date, and a device
  // has no defect record to carry one — filtering it by month would answer a
  // question nobody asked with a number nobody could check.
  const cs = cameraSummary(scoped.camera)
  const ds = dvrSummary(scoped.dvr)
  const casualties = {
    cameras: cs.byCause[CAUSE.DVR] + cs.byCause[CAUSE.MERAKI],
    dvrs: ds.byCause[CAUSE.MERAKI],
  }
  casualties.total = casualties.cameras + casualties.dvrs

  // The kind counts drive the toggles above the map, so they are deliberately
  // read before the kind filter — otherwise choosing one kind would zero the
  // other two and hide the way back.
  const byKind = CCTV_KINDS.map((k) => ({
    key: k.key,
    name: k.plural,
    color: k.color,
    value: all.filter((r) => r.kind === k.key).length,
    fleet: scoped[k.key].length,
  }))

  const pins = sites
    .filter((s) => isNum(s?.lat) && isNum(s?.lng))
    .map((s) => {
      const here = shown.filter((r) => r.siteId === s.id)
      const counts = {}
      for (const k of CCTV_KINDS) counts[k.key] = here.filter((r) => r.kind === k.key).length
      return {
        id: s.id,
        name: s.name || 'Unnamed site',
        lat: s.lat,
        lng: s.lng,
        region: s.region || '',
        entity: s.entity || '',
        total: here.length,
        counts,
        lead: CCTV_KINDS.find((k) => counts[k.key] > 0)?.key || '',
      }
    })
    .filter((p) => p.total > 0)

  const plotted = pins.reduce((n, p) => n + p.total, 0)
  const bySite = group(shown, (r) => r.siteName)

  return {
    total: shown.length,
    devices: scoped.camera.length + scoped.dvr.length + scoped.meraki.length,
    byKind,
    casualties,
    pins,
    // The months anyone can choose between, taken from every defect the viewer
    // may see rather than from the filtered set — a month that vanishes as you
    // use it takes away the way back.
    months: [...new Set(everywhere.filter((r) => visible(r.siteId)).map((r) => r.month).filter(Boolean))].sort(),
    // Of what is on screen, how much of it no range could ever place. Without
    // this the total is unexplainable: it barely moves as the range changes.
    undated: shown.filter((r) => !r.month).length,
    // And how much the range is currently holding back.
    outOfRange,
    // Faults at sites with no coordinates. Reported rather than dropped: a map
    // that silently omits them reads as the whole picture when it is not.
    unmapped: shown.length - plotted,
    sitesAffected: bySite.length,
    bySite,
    byRegion: group(shown, (r) => r.region),
    byFault: (() => {
      const m = new Map()
      for (const r of shown) {
        for (const f of r.faults) {
          const name = faultLabel(r.kind, f)
          const e = m.get(name) || { key: name, name, value: 0, color: CCTV_KINDS[rank(r.kind)]?.color }
          e.value += 1
          m.set(name, e)
        }
      }
      return [...m.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    })(),
  }
}

/**
 * One pin per site, sliced by device kind.
 *
 * Size carries the count, as on the equipment map. Colour carries the KIND,
 * because a site with a dead switch and a site with three smeared lenses need
 * different people on different days — and a site with both is drawn as both
 * rather than flattened to whichever happens to be more numerous. The number in
 * the middle takes the colour of the furthest-upstream fault, the one to fix
 * first.
 */
const pinCache = new Map()
function defectPin(pin) {
  const size = pin.total >= 10 ? 42 : pin.total >= 4 ? 36 : 30
  const key = `${size}:${CCTV_KINDS.map((k) => pin.counts[k.key]).join('-')}`
  if (!pinCache.has(key)) {
    let at = 0
    const stops = []
    for (const k of CCTV_KINDS) {
      const n = pin.counts[k.key] || 0
      if (!n) continue
      const to = at + (n / pin.total) * 100
      stops.push(`${k.color} ${at.toFixed(1)}% ${to.toFixed(1)}%`)
      at = to
    }
    const lead = CCTV_KINDS.find((k) => k.key === pin.lead)?.color || '#57534e'
    const inner = size - 11
    pinCache.set(
      key,
      L.divIcon({
        className: '',
        html: `<div style="transform:translate(-50%,-50%);display:grid;place-items:center;width:${size}px;height:${size}px;border-radius:50%;background:conic-gradient(${stops.join(',')});box-shadow:0 3px 10px rgba(16,24,40,.35)"><span style="display:grid;place-items:center;width:${inner}px;height:${inner}px;border-radius:50%;background:#fff;color:${lead};font:800 ${Math.round(inner / 2.1)}px Inter,sans-serif">${pin.total}</span></div>`,
        iconSize: [size, size],
      })
    )
  }
  return pinCache.get(key)
}

export default function CctvTab({ cameras = [], dvrs = [], merakis = [], sites = [], keepUnplaced = true }) {
  const [siteId, setSiteId] = useState('all')
  const [kind, setKind] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const a = useMemo(
    () => cctvDefectAnalytics({ cameras, dvrs, merakis, sites, siteId, kind, from, to, keepUnplaced }),
    [cameras, dvrs, merakis, sites, siteId, kind, from, to, keepUnplaced]
  )

  const centre = a.pins.length ? [a.pins[0].lat, a.pins[0].lng] : [20, 78]
  const chosen = CCTV_KINDS.find((k) => k.key === kind)
  const fleetOf = (k) => a.byKind.find((r) => r.key === k)?.fleet ?? 0

  // The same range said three ways: short enough to sit under a number, long
  // enough to read inside a sentence, and inverted for what it excluded. An
  // open end is named as an open end — "the earliest to Mar 25" is not English.
  const ranged = Boolean(from || to)
  const rangeShort = from && to ? `${prettyMonth(from)} – ${prettyMonth(to)}`
    : from ? `${prettyMonth(from)} onwards` : `up to ${prettyMonth(to)}`
  const rangeLong = from && to ? `between ${prettyMonth(from)} and ${prettyMonth(to)}`
    : from ? `from ${prettyMonth(from)} onwards` : `up to ${prettyMonth(to)}`
  const outsideRange = from && to ? `outside ${rangeShort}`
    : from ? `before ${prettyMonth(from)}` : `after ${prettyMonth(to)}`

  // Built as a list so the sentence can leave out a kind with none, rather than
  // telling anyone about zero dark DVRs.
  const dark = [
    a.casualties.cameras && `${a.casualties.cameras} camera${plural(a.casualties.cameras)}`,
    a.casualties.dvrs && `${a.casualties.dvrs} DVR${plural(a.casualties.dvrs)}`,
  ].filter(Boolean)
  const one = a.casualties.total === 1

  // An empty map has five quite different meanings and only one of them is a
  // problem the viewer can act on, so each says which it is.
  let mapEmpty
  if (a.devices === 0) {
    mapEmpty = `No CCTV equipment is recorded ${siteId === 'all' ? 'for the sites you can see' : 'at this site'}. Add the Meraki switches first, then the DVRs they carry, then the cameras on each DVR.`
  } else if (a.total === 0 && a.outOfRange > 0) {
    // Said before the "nothing is wrong" lines below, which would otherwise
    // read as an all-clear for faults that are merely out of view.
    mapEmpty = `Nothing was reported ${rangeLong}. ${a.outOfRange} fault${plural(a.outOfRange)} ${a.outOfRange === 1 ? 'was' : 'were'} reported ${outsideRange} — widen the range to see ${a.outOfRange === 1 ? 'it' : 'them'}.`
  } else if (a.total === 0 && chosen) {
    mapEmpty = `Nothing is wrong with the ${chosen.plural} in this scope. Clear the device filter to see the other kinds.`
  } else if (a.total === 0) {
    mapEmpty = a.casualties.total > 0
      ? 'No device here is faulty — everything offline is waiting on something above it, so there is nobody to send out.'
      : 'Every camera, DVR and Meraki in this scope is working.'
  } else {
    mapEmpty = 'Faults exist but none of the affected sites have coordinates. Add a latitude and longitude to a site to see it here.'
  }

  return (
    <div className="animate-fade-in-up">
      <div className="card mb-5 flex flex-wrap items-end gap-3 p-4">
        <Picker id="cctv-site" label="Site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          <option value="all">All sites ({sites.length})</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Picker>
        <Picker id="cctv-kind" label="Device" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="all">All devices</option>
          {CCTV_KINDS.map((k) => <option key={k.key} value={k.key}>{k.plural}</option>)}
        </Picker>
        <Picker id="cctv-from" label="From" value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">Earliest</option>
          {a.months.map((m) => <option key={m} value={m}>{m}</option>)}
        </Picker>
        <Picker id="cctv-to" label="To" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Latest</option>
          {a.months.map((m) => <option key={m} value={m}>{m}</option>)}
        </Picker>
        <button
          type="button"
          onClick={() => { setSiteId('all'); setKind('all'); setFrom(''); setTo('') }}
          className="rounded-2xl bg-clay-surface px-4 py-2.5 text-[12.5px] font-semibold text-ink-700 shadow-clay-sm"
        >
          Reset
        </button>
      </div>

      {/* The range is over the date a defect was REPORTED, which most records do
          not have yet — so what it did, and what it could not do, is spelled out
          next to the numbers rather than left to be inferred from them. */}
      {(a.undated > 0 || a.outOfRange > 0) && (
        <div className="card mb-3 flex items-start gap-2.5 p-4 text-[12.5px] leading-relaxed text-ink-600">
          <CalendarClock size={16} className="mt-0.5 shrink-0 text-ink-400" />
          <span>
            {a.undated > 0 && (
              a.undated === a.total ? (
                <>
                  None of {a.total === 1 ? 'this fault' : `these ${a.total} faults`} has a date on it, so a month
                  range has nothing here to narrow. Open a device on the CCTV inventory page and set “Reported on”
                  to date it — until then it is undated, and an undated fault is shown whatever range you pick.
                </>
              ) : (
                <>
                  <b>{a.undated}</b> of these {a.total} faults {a.undated === 1 ? 'has' : 'have'} no report date and{' '}
                  {a.undated === 1 ? 'is' : 'are'} shown whatever range you pick — a missing date is a gap to fill
                  on the inventory page, not a reason to drop a real fault off the map.
                </>
              )
            )}
            {a.undated > 0 && a.outOfRange > 0 && ' '}
            {a.outOfRange > 0 && (
              <>
                A further <b>{a.outOfRange}</b> {a.outOfRange === 1 ? 'was' : 'were'} reported {outsideRange} and{' '}
                {a.outOfRange === 1 ? 'is' : 'are'} in none of the figures below.
              </>
            )}
          </span>
        </div>
      )}

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={TriangleAlert}
          label="Devices at fault"
          value={a.total}
          sub={`${chosen ? chosen.plural : 'camera, DVR and Meraki'}${ranged ? ` · reported ${rangeShort}` : ''}`}
          tone="#dc2626"
        />
        <Stat icon={MapPin} label="Sites affected" value={a.sitesAffected} tone="#a855f7" />
        {/* The number this whole tab is arranged around: devices that look
            broken in an uptime report and are not. */}
        <Stat
          icon={Unplug}
          label="Dark but not faulty"
          value={a.casualties.total}
          sub="waiting on something upstream"
          tone="#e8a33d"
        />
        <Stat
          icon={Cctv}
          label="Devices in scope"
          value={a.devices}
          sub={`${fleetOf('camera')} cameras · ${fleetOf('dvr')} DVR · ${fleetOf('meraki')} Meraki`}
          tone="#0891b2"
        />
      </div>

      {/* Three kinds, three different contractors. A combined defect count hides
          the only question worth asking of it: which layer is the problem. */}
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        {a.byKind.map((k) => {
          const Icon = CCTV_KINDS[rank(k.key)].icon
          return (
            <button
              key={k.key}
              type="button"
              onClick={() => setKind(kind === k.key ? 'all' : k.key)}
              aria-pressed={kind === k.key}
              className={`card flex items-center gap-4 p-4 text-left transition duration-200 ease-emil hover:-translate-y-0.5 ${
                kind === k.key ? 'ring-2 ring-brand-500' : ''
              }`}
            >
              <span className="grid h-11 w-11 flex-none place-items-center rounded-2xl text-white" style={{ background: k.color }}>
                <Icon size={20} strokeWidth={2.1} />
              </span>
              <span className="min-w-0">
                <span className="block text-[20px] font-extrabold leading-none tracking-[-0.03em] text-ink-900">
                  {k.value}
                </span>
                <span className="mt-1 block text-[12.5px] font-semibold text-ink-700">{k.name} at fault</span>
                <span className="block text-[11px] text-ink-400">
                  {k.fleet === 0 ? 'none recorded here' : `of ${k.fleet} in scope`}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {a.casualties.total > 0 && (
        <div className="card mb-5 flex items-start gap-2.5 p-4 text-[12.5px] leading-relaxed text-ink-600">
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <span>
            <b>{dark.join(' and ')}</b> {one ? 'is' : 'are'} dark because something above {one ? 'it' : 'them'} is
            down. Nothing is wrong with {one ? 'it' : 'them'}, so {one ? 'it is' : 'they are'} not plotted — the
            map shows the outage, not its casualties.
            {ranged && ' Being dark is a fact about right now, so the month range does not apply to this number.'}
          </span>
        </div>
      )}

      <Panel
        title="Where the CCTV faults are"
        subtitle={chosen ? `${chosen.plural} only` : 'Root cause, by device kind'}
        className="mb-5"
      >
        {a.pins.length === 0 ? (
          <NoData height={300}>{mapEmpty}</NoData>
        ) : (
          <>
            <div className="overflow-hidden rounded-[18px]">
              <MapContainer center={centre} zoom={5} scrollWheelZoom style={{ height: 340, width: '100%' }}>
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {a.pins.map((p) => (
                  <Marker key={p.id} position={[p.lat, p.lng]} icon={defectPin(p)}>
                    <LeafletTooltip direction="top" offset={[0, -14]} opacity={1}>
                      <span className="text-[12px] font-semibold">{p.name}</span>
                      {CCTV_KINDS.filter((k) => p.counts[k.key] > 0).map((k) => (
                        <span key={k.key} className="block text-[11px]">
                          {p.counts[k.key]} {p.counts[k.key] === 1 ? k.name : k.plural} at fault
                        </span>
                      ))}
                      {(p.region || p.entity) && (
                        <span className="block text-[11px]">{[p.region, p.entity].filter(Boolean).join(' · ')}</span>
                      )}
                    </LeafletTooltip>
                  </Marker>
                ))}
              </MapContainer>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {CCTV_KINDS.map((k) => (
                <span key={k.key} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-600">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: k.color }} />
                  {k.plural}
                </span>
              ))}
              <span className="text-[11.5px] text-ink-400">A pin is split where a site has more than one kind.</span>
            </div>

            {a.unmapped > 0 && (
              /* Silently dropping these would make the map read as the whole
                 picture when it is not. */
              <p className="mt-2 text-[11.5px] text-ink-400">
                {a.unmapped} fault{plural(a.unmapped)} sit at sites without coordinates and{' '}
                {a.unmapped === 1 ? 'is' : 'are'} not plotted. They are included in the counts below.
              </p>
            )}
          </>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown title="By site" subtitle="Coloured by the furthest-upstream fault at each" rows={a.bySite} />
        <Breakdown title="By fault" subtitle="One device can carry more than one" rows={a.byFault} />
        <Breakdown title="By region" rows={a.byRegion} />
      </div>
    </div>
  )
}
