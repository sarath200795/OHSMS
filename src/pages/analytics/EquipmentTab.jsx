import { useMemo, useState } from 'react'
import { MapContainer, TileLayer, Marker, Tooltip as LeafletTooltip } from 'react-leaflet'
import L from 'leaflet'
import { HeartPulse, ShieldCheck, TriangleAlert, MapPin } from 'lucide-react'
import { Panel, Stat, NoData, Picker } from './ui'
import { equipmentAnalytics } from './moduleAnalytics'
import Breakdown from './Breakdown'

// Pin size and colour carry the count, so a site with one finding and a site
// with thirty are distinguishable before anything is clicked.
const pinCache = {}
function defectPin(count) {
  const key = count >= 10 ? 'hi' : count >= 4 ? 'mid' : 'lo'
  if (!pinCache[key]) {
    const size = key === 'hi' ? 42 : key === 'mid' ? 36 : 30
    const color = key === 'hi' ? '#b91c1c' : key === 'mid' ? '#dc2626' : '#f59e0b'
    pinCache[key] = { size, color }
  }
  const { size, color } = pinCache[key]
  return L.divIcon({
    className: '',
    html: `<div style="transform:translate(-50%,-50%);display:grid;place-items:center;width:${size}px;height:${size}px;border-radius:50%;background:${color};color:#fff;font:800 ${size / 2.8}px Inter,sans-serif;border:2.5px solid #fff;box-shadow:0 3px 10px rgba(16,24,40,.35)">${count}</div>`,
    iconSize: [size, size],
  })
}

export default function EquipmentTab({ extinguishers, aeds, fas, sites, keepUnplaced = true }) {
  const [siteId, setSiteId] = useState('all')
  const [defectType, setDefectType] = useState('all')

  const a = useMemo(
    () => equipmentAnalytics({ extinguishers, aeds, fas, sites, siteId, defectType, keepUnplaced }),
    [extinguishers, aeds, fas, sites, siteId, defectType, keepUnplaced]
  )

  const centre = a.pins.length ? [a.pins[0].lat, a.pins[0].lng] : [20, 78]
  const unmapped = a.bySite.reduce((n, r) => n + r.value, 0) - a.pins.reduce((n, p) => n + p.defects, 0)

  return (
    <div className="animate-fade-in-up">
      <div className="card mb-5 flex flex-wrap items-end gap-3 p-4">
        <Picker id="eq-site" label="Site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          <option value="all">All sites ({sites.length})</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Picker>
        <Picker id="eq-defect" label="Defect type" value={defectType} onChange={(e) => setDefectType(e.target.value)}>
          <option value="all">All defect types</option>
          {a.defectTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </Picker>
        <button
          type="button"
          onClick={() => { setSiteId('all'); setDefectType('all') }}
          className="rounded-2xl bg-clay-surface px-4 py-2.5 text-[12.5px] font-semibold text-ink-700 shadow-clay-sm"
        >
          Reset
        </button>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={ShieldCheck} label="Fleet health" value={a.healthPct === null ? '—' : `${a.healthPct}%`} sub={`${a.healthy} of ${a.total} ready`} tone="#16a34a" />
        <Stat icon={TriangleAlert} label="Assets with a defect" value={a.faulty} sub="any kind" tone="#dc2626" />
        <Stat icon={HeartPulse} label="Total assets" value={a.total} sub="extinguishers, AED, alarm" tone="#0891b2" />
        <Stat icon={MapPin} label="Sites affected" value={a.bySite.length} tone="#a855f7" />
      </div>

      <Panel
        title="Where the defects are"
        subtitle={defectType === 'all' ? 'Every open finding' : defectType}
        className="mb-5"
      >
        {a.pins.length === 0 ? (
          <NoData height={300}>
            {a.faulty === 0
              ? 'No defects recorded — nothing to plot.'
              : 'Defects exist but none of the affected sites have coordinates. Add latitude and longitude to a site to see it here.'}
          </NoData>
        ) : (
          <>
            <div className="overflow-hidden rounded-[18px]">
              <MapContainer center={centre} zoom={5} scrollWheelZoom style={{ height: 340, width: '100%' }}>
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {a.pins.map((p) => (
                  <Marker key={p.id} position={[p.lat, p.lng]} icon={defectPin(p.defects)}>
                    <LeafletTooltip direction="top" offset={[0, -14]} opacity={1}>
                      <span className="text-[12px] font-semibold">{p.name}</span>
                      <br />
                      <span className="text-[11px]">{p.defects} defect{p.defects === 1 ? '' : 's'}</span>
                      {(p.region || p.entity) && (
                        <>
                          <br />
                          <span className="text-[11px]">{[p.region, p.entity].filter(Boolean).join(' · ')}</span>
                        </>
                      )}
                    </LeafletTooltip>
                  </Marker>
                ))}
              </MapContainer>
            </div>
            {unmapped > 0 && (
              /* Silently dropping these would make the map read as the whole
                 picture when it is not. */
              <p className="mt-3 text-[11.5px] text-ink-400">
                {unmapped} defect{unmapped === 1 ? '' : 's'} sit at sites without coordinates and are not
                plotted. They are included in the counts below.
              </p>
            )}
          </>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown title="By defect type" rows={a.byType} />
        <Breakdown title="By site" rows={a.bySite} />
        <Breakdown title="By region" rows={a.byRegion} />
        <Breakdown title="By entity" rows={a.byEntity} />
      </div>
    </div>
  )
}
