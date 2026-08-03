import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Hash, Save, Play } from 'lucide-react'
import { Card, Field, Input, Button } from '../../shared/ui'
import { useAuth } from '../../shared/auth/AuthContext'
import {
  DOC_KIND_LABEL, deriveOrgCode, normalizeOrgCode, formatDocId,
} from '../../shared/docId/format'
import { getOrgCode, setOrgCode, readCounters, _clearOrgCodeCache } from '../../shared/docId/reserve'
import { backfillAll, BACKFILL_KINDS } from '../../shared/docId/backfill'

/**
 * The org's document-id settings: the short code that appears in every id, and
 * the one-off that numbers records created before the scheme existed.
 *
 * The backfill is deliberately a button an admin presses rather than something
 * that runs on load. It writes to every module's collection, and that is not a
 * thing to do silently behind someone's back the first time they open a page.
 */
export default function DocumentIds() {
  const { orgId, orgName } = useAuth()
  const [code, setCode] = useState('')
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState([])
  const [counters, setCounters] = useState({})

  useEffect(() => {
    if (!orgId) return
    getOrgCode(orgId).then((c) => { setCode(c); setSaved(c) })
    readCounters(orgId).then(setCounters)
  }, [orgId])

  const save = async () => {
    const clean = normalizeOrgCode(code)
    if (!clean) return toast.error('Use 2–5 letters or digits')
    setBusy(true)
    try {
      await setOrgCode(orgId, clean)
      setCode(clean)
      setSaved(clean)
      toast.success(`Document ids will now read ${formatDocId('incidents', clean, 1)}`)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const run = async () => {
    setRunning(true)
    setResults([])
    try {
      _clearOrgCodeCache()
      const out = await backfillAll(orgId, {
        onProgress: (r) => setResults((prev) => [...prev, r]),
      })
      const assigned = out.reduce((n, r) => n + r.assigned, 0)
      const failed = out.filter((r) => r.error)
      setCounters(await readCounters(orgId))
      if (failed.length) {
        toast.error(`Numbered ${assigned}, but ${failed.length} kind${failed.length === 1 ? '' : 's'} failed`)
      } else {
        toast.success(assigned ? `Numbered ${assigned} existing records` : 'Everything already has an id')
      }
    } catch (e) {
      toast.error(e.message || 'Backfill failed')
    } finally {
      setRunning(false)
    }
  }

  const preview = normalizeOrgCode(code) || 'ORG'
  const suggestion = deriveOrgCode(orgName)

  return (
    <div className="max-w-2xl space-y-5">
      <Card>
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-ink-800">
          <Hash size={16} /> Document ID code
        </h3>
        <p className="mb-4 text-sm text-ink-500">
          Every record the app creates is numbered <code className="rounded bg-clay-100 px-1">MODULE-{preview}_0001</code>.
          The counter runs continuously per module and never resets.
        </p>

        <Field label="Organization code" hint="2–5 letters or digits. Appears in every document id.">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={5}
            placeholder={suggestion}
            className="w-40 font-mono tracking-widest"
          />
        </Field>

        <div className="mt-3 flex flex-wrap gap-2 text-xs text-ink-400">
          {['incidents', 'ptw', 'hira'].map((k) => (
            <span key={k} className="rounded-lg bg-clay-100 px-2 py-1 font-mono text-ink-600">
              {formatDocId(k, preview, k === 'ptw' ? 12 : 1)}
            </span>
          ))}
        </div>

        <div className="mt-4">
          <Button icon={Save} loading={busy} onClick={save} disabled={normalizeOrgCode(code) === saved}>
            Save code
          </Button>
        </div>

        {saved && normalizeOrgCode(code) !== saved && (
          <p className="mt-2 text-xs text-amber-700">
            Changing this only affects ids issued from now on. Records already numbered keep the
            id they were given — an id that has been quoted or printed cannot change.
          </p>
        )}
      </Card>

      <Card>
        <h3 className="mb-1 font-semibold text-ink-800">Number existing records</h3>
        <p className="mb-4 text-sm text-ink-500">
          Records created before document ids existed have none. This gives them one, oldest first,
          across every module. Records that already have an id are left alone, so it is safe to run
          again if it is interrupted.
        </p>

        <Button icon={Play} loading={running} onClick={run}>
          {running ? 'Numbering…' : 'Assign document IDs'}
        </Button>

        {results.length > 0 && (
          <ul className="mt-4 space-y-1.5 text-sm">
            {results.map((r) => (
              <li key={r.kind} className="flex items-baseline justify-between gap-3 border-b border-ink-50 pb-1.5">
                <span className="text-ink-700">{DOC_KIND_LABEL[r.kind] || r.kind}</span>
                {r.error ? (
                  <span className="text-xs font-semibold text-red-600">{r.error}</span>
                ) : r.assigned ? (
                  <span className="font-mono text-xs text-ink-500">
                    {r.assigned} numbered {String(r.from).padStart(4, '0')}–{String(r.to).padStart(4, '0')}
                  </span>
                ) : (
                  <span className="text-xs text-ink-300">
                    {r.total ? 'all already numbered' : 'nothing to number'}
                  </span>
                )}
              </li>
            ))}
            {running && <li className="pt-1 text-xs italic text-ink-300">
              {results.length} of {BACKFILL_KINDS.length}…
            </li>}
          </ul>
        )}
      </Card>

      <Card>
        <h3 className="mb-3 font-semibold text-ink-800">Last number issued</h3>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {BACKFILL_KINDS.map((k) => (
            <li key={k} className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate text-ink-500">{DOC_KIND_LABEL[k]}</span>
              <span className="font-mono text-xs text-ink-700">
                {counters[k] ? formatDocId(k, preview, counters[k]) : '—'}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
