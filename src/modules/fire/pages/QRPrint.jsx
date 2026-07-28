import { useMemo, useRef, useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useReactToPrint } from 'react-to-print'
import { QRCodeSVG } from 'qrcode.react'
import { QrCode, Printer, CheckSquare, Square, Search } from 'lucide-react'
import { PageHeader, EmptyState } from '../components/ui'
import ListFilters from '../components/ListFilters'
import { useFleet } from '../context/FleetContext'
import { publicQrUrl } from '../lib/qr'
import { emptyFilters, applyListFilters, hasActiveFilters } from '../lib/listFilter'

const HEADER = { ext: '🔥 Fire Marshal', aed: '❤️ AED', fas: '🔔 Fire Alarm' }

export default function QRPrint() {
  const { extinguishers, aeds, fas } = useFleet()
  const location = useLocation()
  const printRef = useRef(null)

  const [assetType, setAssetType] = useState('ext') // 'ext' | 'aed' | 'fas'
  const [selected, setSelected] = useState(() => new Set(location.state?.ids || []))
  const [filters, setFilters] = useState(emptyFilters())
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (location.state?.ids?.length) { setAssetType('ext'); setSelected(new Set(location.state.ids)) }
  }, [location.state])

  // Per-type config: source list + how to label a card.
  const CFG = {
    ext: { tab: 'Extinguishers', list: extinguishers, big: (e) => e.serialNo || '—', sub: (e) => [e.type, e.capacity, e.entity].filter(Boolean).join(' · '), name: (e) => e.serialNo || e.type },
    aed: { tab: 'AED', list: aeds, big: (a) => a.assetId || 'AED', sub: (a) => [a.brand, a.model].filter(Boolean).join(' ') || 'AED', name: (a) => a.assetId || 'AED' },
    fas: { tab: 'FAS', list: fas, big: (a) => a.deviceId || a.deviceType, sub: (a) => [a.deviceType, a.zone].filter(Boolean).join(' · '), name: (a) => a.deviceId || a.deviceType },
  }
  const cfg = CFG[assetType]
  const source = cfg.list

  const filtered = useMemo(() => {
    if (assetType === 'ext') return applyListFilters(extinguishers, filters)
    const q = search.trim().toLowerCase()
    return source.filter((a) => !q || `${cfg.name(a)} ${a.centerName || ''} ${a.location || ''}`.toLowerCase().includes(q))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetType, extinguishers, filters, source, search])
  const filtersActive = assetType === 'ext' ? hasActiveFilters(filters) : !!search.trim()

  const items = useMemo(() => source.filter((e) => selected.has(e.id)), [source, selected])

  const toggle = (id) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allOn = filtered.length > 0 && filtered.every((e) => selected.has(e.id))
  const toggleAll = () => setSelected((prev) => {
    const n = new Set(prev)
    if (allOn) filtered.forEach((e) => n.delete(e.id)); else filtered.forEach((e) => n.add(e.id))
    return n
  })
  const switchType = (t) => { setAssetType(t); setSelected(new Set()); setSearch(''); setFilters(emptyFilters()) }

  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    documentTitle: 'Fire-Marshal-QR-Codes',
    pageStyle: `
      @page { size: A4; margin: 12mm; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .qr-print-grid { display: grid !important; grid-template-columns: repeat(3, 1fr) !important; gap: 8mm !important; }
        .qr-print-card { break-inside: avoid; page-break-inside: avoid; min-height: 46mm; box-shadow: none !important; }
        .qr-print-code { width: 34mm !important; height: 34mm !important; }
      }
    `,
  })

  return (
    <div>
      <PageHeader title="Print QR Codes" subtitle={`${items.length} selected for printing`} icon={QrCode}>
        <div className="flex rounded-xl bg-clay-100 p-1 no-print">
          {Object.entries(CFG).map(([k, c]) => (
            <button key={k} onClick={() => switchType(k)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${assetType === k ? 'bg-white text-ink-900 shadow-clay-sm' : 'text-ink-500'}`}>
              {c.tab}
            </button>
          ))}
        </div>
        <button className="btn-primary" onClick={handlePrint} disabled={!items.length}>
          <Printer size={16} /> Print {items.length || ''}
        </button>
      </PageHeader>

      {source.length === 0 ? (
        <EmptyState icon={QrCode} title={`No ${cfg.tab}`} hint={`Add ${cfg.tab} to generate QR codes.`} />
      ) : (
        <>
        <div className="no-print">
          {assetType === 'ext' ? (
            <ListFilters filters={filters} onChange={setFilters} showStatus searchPlaceholder="Search serial, center or type…" />
          ) : (
            <div className="card mb-4 p-4">
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input className="input pl-9" placeholder={`Search ${cfg.tab} by ID, site or location…`} value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-4">
          <aside className="card h-fit p-4 lg:col-span-1 no-print">
            <button onClick={toggleAll} disabled={!filtered.length} className="mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold hover:bg-ink-50 disabled:opacity-40">
              {allOn ? <CheckSquare size={16} className="text-brand-500" /> : <Square size={16} className="text-ink-400" />}
              Select all ({filtered.length}{filtersActive ? ` of ${source.length}` : ''})
            </button>
            <p className="mb-2 px-2 text-xs text-ink-400">{items.length} selected for printing</p>
            {filtered.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-ink-400">No matches.</p>
            ) : (
              <div className="max-h-[60vh] space-y-1 overflow-y-auto">
                {filtered.map((e) => {
                  const on = selected.has(e.id)
                  return (
                    <button key={e.id} onClick={() => toggle(e.id)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${on ? 'bg-brand-50 text-brand-700' : 'hover:bg-ink-50'}`}>
                      {on ? <CheckSquare size={15} className="shrink-0 text-brand-500" /> : <Square size={15} className="shrink-0 text-ink-300" />}
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-semibold">{cfg.name(e)}</span>{' '}
                        <span className="text-ink-400">{e.centerName}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </aside>

          <div className="lg:col-span-3">
            {items.length === 0 ? (
              <EmptyState icon={Printer} title="Nothing selected" hint={`Pick ${cfg.tab} on the left to print their QR codes.`} />
            ) : (
              <div ref={printRef} className="qr-print-grid grid grid-cols-2 gap-4 sm:grid-cols-3">
                {items.map((e) => (
                  <div key={e.id} className="qr-print-card flex flex-col items-center rounded-2xl border border-ink-200 bg-white p-4 text-center">
                    <div className="mb-1 text-xs font-extrabold uppercase tracking-wide text-brand-600">{HEADER[assetType]}</div>
                    <QRCodeSVG className="qr-print-code" value={publicQrUrl(e.qrToken)} size={148} level="H" includeMargin fgColor="#000000" bgColor="#ffffff" />
                    <p className="mt-2 text-sm font-extrabold text-ink-900">{cfg.big(e)}</p>
                    <p className="text-xs text-ink-500">{cfg.sub(e)}</p>
                    <p className="truncate text-xs text-ink-400">{e.centerName}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        </>
      )}
    </div>
  )
}
