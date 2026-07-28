import { useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Tooltip, Popup, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import L from 'leaflet'
import { MapPin } from 'lucide-react'

// Distinct, map-legible colours cycled across entities.
const PALETTE = [
  '#0d9488', '#dc2626', '#2563eb', '#d97706', '#7c3aed', '#059669',
  '#db2777', '#0891b2', '#ca8a04', '#4f46e5', '#e11d48', '#65a30d',
]
const NO_ENTITY = '#64748b'

// Coloured teal/… "clay" pin as an HTML divIcon, cached per colour so 100s of
// markers reuse a handful of icon instances.
const iconCache = {}
function pinIcon(color) {
  if (!iconCache[color]) {
    iconCache[color] = L.divIcon({
      className: '',
      html: `<div style="transform:translate(-50%,-100%)">
        <svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
          <path d="M15 0C6.7 0 0 6.7 0 15c0 10 15 25 15 25s15-15 15-25C30 6.7 23.3 0 15 0z" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>
          <circle cx="15" cy="15" r="5.5" fill="#fff"/>
        </svg></div>`,
      iconSize: [30, 40],
      iconAnchor: [15, 40],
    })
  }
  return iconCache[color]
}

function FitBounds({ points }) {
  const map = useMap()
  useMemo(() => {
    if (points.length === 0) return
    if (points.length === 1) map.setView(points[0], 12)
    else map.fitBounds(points, { padding: [40, 40], maxZoom: 13 })
  }, [points, map])
  return null
}

// Clay-styled cluster badge sized by child count.
function createClusterIcon(cluster) {
  const count = cluster.getChildCount()
  const size = count < 10 ? 34 : count < 100 ? 42 : 50
  return L.divIcon({
    className: '',
    html: `<div class="site-cluster" style="width:${size}px;height:${size}px">${count}</div>`,
    iconSize: [size, size],
  })
}

const Dot = ({ color }) => (
  <span
    style={{
      display: 'inline-block', width: 9, height: 9, borderRadius: '50%',
      background: color, marginRight: 6, verticalAlign: 'middle',
    }}
  />
)

export default function SitesMap({ sites, stats = {}, onSelect, onEdit, onDelete, canManage }) {
  const located = sites.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number')
  const points = located.map((s) => [s.lat, s.lng])
  const center = points[0] || [20, 0]

  // Entity → colour mapping (drives pins + legend).
  const entities = useMemo(
    () => [...new Set(located.map((s) => s.entity).filter(Boolean))].sort(),
    [located]
  )
  const colorOf = (entity) => (entity ? PALETTE[entities.indexOf(entity) % PALETTE.length] : NO_ENTITY)
  const hasUnassigned = located.some((s) => !s.entity)

  if (located.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-3 p-10 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-clay-100 text-ink-400 shadow-clay-inset">
          <MapPin size={26} />
        </span>
        <div>
          <h3 className="font-semibold text-ink-800">No mapped sites yet</h3>
          <p className="mt-1 text-sm text-ink-500">
            Add latitude &amp; longitude to a site to see it on the map.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="card relative overflow-hidden p-0">
      <MapContainer center={center} zoom={5} scrollWheelZoom style={{ height: '65vh', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={points} />
        <MarkerClusterGroup
          chunkedLoading
          maxClusterRadius={55}
          showCoverageOnHover={false}
          spiderfyOnMaxZoom
          iconCreateFunction={createClusterIcon}
        >
        {located.map((s) => {
          const st = stats[s.id]
          const color = colorOf(s.entity)
          return (
            <Marker key={s.id} position={[s.lat, s.lng]} icon={pinIcon(color)}>
              <Tooltip direction="auto" offset={[0, -6]} opacity={1} className="site-bubble" sticky>
                <div className="site-bubble-card">
                  <div className="site-bubble-title"><Dot color={color} />{s.name}</div>
                  <div className="site-bubble-sub">{[s.region, s.entity].filter(Boolean).join(' · ') || '—'}</div>
                  {s.address && <div className="site-bubble-addr">{s.address}</div>}
                  {st && (
                    <div className="site-bubble-stats">
                      <span>🧯 Extinguishers <b>{st.extinguishers}</b></span>
                      <span>❤️ AED <b>{st.aeds}</b></span>
                      <span>🩹 First aid <b>{st.firstAidBoxes}</b></span>
                      <span>⚠️ Incidents <b>{st.incidentsTotal}</b></span>
                      <span>✅ Open actions <b>{st.openActions}</b></span>
                      <span>👤 Employees <b>{st.employees.length}</b></span>
                    </div>
                  )}
                  <div className="site-bubble-hint">Click the pin for actions</div>
                </div>
              </Tooltip>

              <Popup>
                <div style={{ minWidth: 170 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}><Dot color={color} />{s.name}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{[s.region, s.entity].filter(Boolean).join(' · ') || '—'}</div>
                  {s.address && <div style={{ fontSize: 11, color: '#94a3b8' }}>{s.address}</div>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button onClick={() => onSelect?.(s)} className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700">Summary</button>
                    {canManage && <button onClick={() => onEdit?.(s)} className="rounded-lg bg-clay-100 px-2.5 py-1 text-xs font-semibold text-ink-700 hover:bg-clay-200">Edit</button>}
                    {canManage && <button onClick={() => onDelete?.(s)} className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-100">Delete</button>}
                  </div>
                </div>
              </Popup>
            </Marker>
          )
        })}
        </MarkerClusterGroup>
      </MapContainer>

      {/* Entity colour legend */}
      {(entities.length > 0 || hasUnassigned) && (
        <div className="absolute right-3 top-3 z-[1000] max-h-[60%] w-44 overflow-auto rounded-2xl bg-white/95 p-3 shadow-lg backdrop-blur">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-400">Entity</p>
          <ul className="space-y-1">
            {entities.map((e) => (
              <li key={e} className="flex items-center gap-2 text-xs text-ink-700">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: colorOf(e) }} />
                <span className="truncate">{e}</span>
              </li>
            ))}
            {hasUnassigned && (
              <li className="flex items-center gap-2 text-xs text-ink-500">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: NO_ENTITY }} />
                <span className="truncate italic">Unassigned</span>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
