import { useState, useCallback } from 'react'
import { CheckCircle2, XCircle, Loader2, Wifi, ShieldAlert, RefreshCw } from 'lucide-react'
import { runConnectivityChecks } from '../lib/connectivity'

const VERDICT_META = {
  ok: { color: '#16a34a', title: 'Connection looks healthy' },
  intercepted: { color: '#dc2626', title: 'Google is being blocked by a VPN, antivirus, or firewall' },
  blocked: { color: '#d97706', title: 'A browser extension or DNS is blocking Google' },
  offline: { color: '#dc2626', title: 'Your internet connection looks down' },
}

/**
 * Runs the connectivity probes and shows a plain-language result. Used on the
 * /diagnostics page and offered from the auth screens after a network error.
 */
export default function ConnectivityDiagnostics({ auto = false }) {
  const [state, setState] = useState({ running: false, result: null })

  const run = useCallback(async () => {
    setState({ running: true, result: null })
    try {
      const result = await runConnectivityChecks()
      setState({ running: false, result })
    } catch (e) {
      setState({ running: false, result: { checks: [], verdict: 'offline', advice: 'Could not run the check: ' + (e?.message || e) } })
    }
  }, [])

  // Kick off automatically when embedded after an error.
  if (auto && !state.running && !state.result) run()

  const { running, result } = state
  const verdict = result && (VERDICT_META[result.verdict] || VERDICT_META.offline)

  return (
    <div className="space-y-4">
      <button onClick={run} disabled={running} className="btn-primary w-full">
        {running ? <Loader2 size={18} className="animate-spin" /> : <Wifi size={16} />}
        {running ? 'Checking connection…' : 'Run connection check'}
      </button>

      {result && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-xl p-3" style={{ backgroundColor: `${verdict.color}14`, color: verdict.color }}>
            <ShieldAlert size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-bold">{verdict.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-600">{result.advice}</p>
            </div>
          </div>

          <ul className="space-y-2">
            {result.checks.map((c) => (
              <li key={c.name} className="rounded-xl bg-clay-surface/70 p-3 shadow-clay-inset">
                <div className="flex items-center gap-2">
                  {c.ok ? <CheckCircle2 size={16} className="text-green-600" /> : <XCircle size={16} className="text-red-500" />}
                  <span className="text-sm font-semibold text-ink-800">{c.name}</span>
                </div>
                <p className="mt-1 pl-6 text-xs text-ink-500">{c.label}</p>
                {!c.ok && c.hint && <p className="mt-1 pl-6 text-xs font-medium text-ink-700">{c.hint}</p>}
              </li>
            ))}
          </ul>

          <button onClick={run} disabled={running} className="btn-ghost w-full text-xs">
            <RefreshCw size={13} /> Run again
          </button>
        </div>
      )}
    </div>
  )
}
