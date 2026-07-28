import { useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Upload, Download, FileSpreadsheet, CheckCircle2, AlertTriangle, X, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { PageHeader, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { downloadAssetTemplate, parseAssetUpload, AED_BULK_COLUMNS, FAS_BULK_COLUMNS } from '../lib/exporter'
import { bulkAddAeds, bulkAddFas } from '../lib/firestore'

const CFG = {
  aed: {
    label: 'AED', columns: AED_BULK_COLUMNS, add: bulkAddAeds,
    cols: [['Asset ID', 'assetId'], ['Site', 'centerName'], ['Region', 'region'], ['Entity', 'entity'], ['Battery Exp', 'batteryExpiry'], ['Pad Exp', 'padExpiry'], ['Status', 'status']],
  },
  fas: {
    label: 'FAS', columns: FAS_BULK_COLUMNS, add: bulkAddFas,
    cols: [['Device ID', 'deviceId'], ['Type', 'deviceType'], ['Site', 'centerName'], ['Region', 'region'], ['Next Service', 'nextService'], ['Status', 'status']],
  },
}

export default function AssetBulkUpload() {
  const { orgId, orgName, profile } = useAuth()
  const location = useLocation()
  const inputRef = useRef(null)
  const [kind, setKind] = useState(location.state?.kind === 'fas' ? 'fas' : 'aed')
  const [fileName, setFileName] = useState('')
  const [parsing, setParsing] = useState(false)
  const [result, setResult] = useState(null)
  const [committing, setCommitting] = useState(false)
  const [done, setDone] = useState(null)

  const cfg = CFG[kind]
  const reset = () => { setResult(null); setFileName(''); setDone(null) }
  const switchKind = (k) => { setKind(k); reset() }

  const handleFile = async (file) => {
    if (!file) return
    setFileName(file.name); setParsing(true); setResult(null)
    try {
      const r = await parseAssetUpload(kind, file)
      setResult(r)
      if (!r.valid.length) toast.error('No valid rows found')
      else toast.success(`${r.valid.length} valid row(s) ready`)
    } catch { toast.error('Could not read that file') } finally { setParsing(false) }
  }

  const commit = async () => {
    if (!result?.valid.length) return
    setCommitting(true)
    try {
      const res = await cfg.add(orgId, orgName, result.valid, { uid: profile?.uid, name: profile?.name })
      setResult(null); setFileName(''); setDone(res)
      toast.success(`${res.created} ${cfg.label} added`)
    } catch (e) { toast.error(e.message) } finally { setCommitting(false) }
  }

  return (
    <div>
      <PageHeader title="Bulk Upload — AED / FAS" subtitle={`Import many ${cfg.label} records from a spreadsheet. Every row is added as a new record with its own QR code.`} icon={Upload}>
        <div className="flex rounded-xl bg-clay-100 p-1 no-print">
          {Object.entries(CFG).map(([k, c]) => (
            <button key={k} onClick={() => switchKind(k)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${kind === k ? 'bg-white text-ink-900 shadow-clay-sm' : 'text-ink-500'}`}>{c.label}</button>
          ))}
        </div>
        <button className="btn-ghost" onClick={() => downloadAssetTemplate(kind)}><Download size={16} /> Download template</button>
      </PageHeader>

      {done ? (
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="card mx-auto max-w-lg p-8 text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-green-100 text-green-600"><CheckCircle2 size={34} /></div>
          <h2 className="text-xl font-extrabold">Import complete</h2>
          <p className="mt-1 text-sm text-ink-500"><strong>{done.created}</strong> {cfg.label} record(s) added, each with a unique QR code.</p>
          <div className="mt-6 flex justify-center gap-3">
            <button className="btn-primary" onClick={reset}>Import more</button>
            <a className="btn-ghost" href={kind === 'aed' ? '/equipment/aed' : '/equipment/fas'}>View {cfg.label} repository</a>
          </div>
        </motion.div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]) }}
              className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl bg-clay-surface px-6 py-14 text-center shadow-clay-inset transition hover:bg-brand-50/40"
            >
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-500">
                {parsing ? <Loader2 className="animate-spin" /> : <FileSpreadsheet size={26} />}
              </div>
              <p className="font-bold text-ink-800">{fileName || 'Click to upload or drag & drop'}</p>
              <p className="text-sm text-ink-500">.xlsx or .csv using the {cfg.label} template columns</p>
              <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
            </div>

            {result && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="chip bg-green-100 text-green-700"><CheckCircle2 size={14} /> {result.valid.length} valid</span>
                  {result.errors.length > 0 && <span className="chip bg-red-100 text-red-700"><AlertTriangle size={14} /> {result.errors.length} with issues</span>}
                  <span className="text-sm text-ink-500">{result.total} total rows</span>
                </div>

                {result.valid.length > 0 && (
                  <div className="card overflow-hidden">
                    <div className="border-b border-ink-100 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-ink-500">Preview ({Math.min(result.valid.length, 10)} of {result.valid.length})</div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-clay-100/70 text-left text-xs uppercase text-ink-400">
                          <tr>{cfg.cols.map(([h]) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
                        </thead>
                        <tbody className="divide-y divide-ink-100">
                          {result.valid.slice(0, 10).map((r, i) => (
                            <tr key={i}>{cfg.cols.map(([h, f]) => <td key={h} className="px-3 py-2">{r[f] || '—'}</td>)}</tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {result.errors.length > 0 && (
                  <div className="card overflow-hidden border border-red-200">
                    <div className="border-b border-red-100 bg-red-50 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-red-600">Rows skipped</div>
                    <ul className="divide-y divide-ink-100 text-sm">
                      {result.errors.slice(0, 10).map((e, i) => (
                        <li key={i} className="flex items-start gap-2 px-4 py-2.5"><X size={15} className="mt-0.5 shrink-0 text-red-500" /><span><strong>Row {e.row}:</strong> {e.issues.join('; ')}</span></li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.valid.length > 0 && (
                  <div className="flex justify-end gap-3">
                    <button className="btn-ghost" onClick={reset}>Cancel</button>
                    <button className="btn-primary" onClick={commit} disabled={committing}>
                      {committing ? <Spinner size={18} /> : `Import ${result.valid.length} ${cfg.label}`}
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </div>

          <aside className="card h-fit space-y-3 p-6">
            <h3 className="text-sm font-bold uppercase tracking-wide text-ink-500">How it works</h3>
            <ol className="space-y-2 text-sm text-ink-600">
              <li>1. Pick <strong>{cfg.label}</strong> and download the template.</li>
              <li>2. Fill one {cfg.label} per row. <strong>Site</strong> is required.</li>
              <li>3. Upload — rows are validated against the allowed values.</li>
              <li>4. Review, then import. Each row becomes a new record with a QR code.</li>
            </ol>
            <div className="rounded-2xl bg-clay-surface p-3 shadow-clay-inset">
              <p className="mb-1 text-xs font-bold uppercase text-ink-500">Columns</p>
              <div className="flex flex-wrap gap-1.5">
                {cfg.columns.map((c) => <span key={c} className="chip bg-clay-surface text-ink-600">{c}</span>)}
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
