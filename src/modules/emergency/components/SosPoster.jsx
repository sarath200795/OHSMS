import { Printer, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PrintIsolate } from '../../../shared/ui'
import { useAuth } from '../../../shared/auth/AuthContext'

// "THERE'S SAFETY IN NUMBERS" emergency poster — the org's standard SOS format.
// Primary column = national emergency numbers; Secondary = this site's mapped
// local services (hospital / police station / fire station).
const NATIONAL = {
  Medical: '102/108',
  Police: '100',
  Fire: '101',
}

const ACCENTS = [
  { key: 'pink', label: 'Pink', color: '#EC297B', text: '#ffffff' },
  { key: 'blue', label: 'Blue', color: '#16A6DE', text: '#ffffff' },
  { key: 'yellow', label: 'Yellow', color: '#F5E11B', text: '#111111' },
]

/** Pick the site's contact for a poster row, tolerating role synonyms. */
function pick(contacts, matchers) {
  return contacts.find((c) => matchers.some((m) => (c.role || '').toLowerCase().includes(m)))
}

export default function SosPoster({ site, contacts, accent = 'pink', onAccent, onClose }) {
  const { org, isAdmin } = useAuth()
  const ext = (contacts || []).filter((c) => c.kind === 'external')
  const rows = [
    { dept: 'Medical', contact: pick(ext, ['hospital', 'ambulance', 'medical']) },
    { dept: 'Police', contact: pick(ext, ['police']) },
    { dept: 'Fire', contact: pick(ext, ['fire']) },
  ]
  // Safety & Security helpline is org-wide (Org Settings → General), so the same
  // numbers print on every site's poster.
  const helpline = {
    primary: org?.safetyHelplinePrimary || '',
    secondary: org?.safetyHelplineSecondary || '',
  }
  const theme = ACCENTS.find((a) => a.key === accent) || ACCENTS[0]

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
      <PrintIsolate id="sos-poster" />
      {/* Decorative scrim. It is not a tab stop and must not be: the keyboard way
          out of a dialog is Escape, which useFocusTrap handles, and making the
          backdrop focusable would put a nameless control in the tab order in
          front of the dialog it is dimming. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div aria-hidden="true" className="absolute inset-0 bg-ink-950/60 backdrop-blur-sm print:hidden" onClick={onClose} />

      <div className="relative z-10 w-full max-w-[640px]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
          <div className="flex items-center gap-1.5">
            {ACCENTS.map((a) => (
              // A colour swatch has no text at all, and which one is chosen is
              // carried purely by a scale-110 and a brighter border — neither of
              // which is a state anything but an eye can read. aria-pressed is
              // the selection; the label is the colour's name.
              <button
                key={a.key}
                onClick={() => onAccent?.(a.key)}
                aria-label={`${a.label} banner`}
                aria-pressed={accent === a.key}
                title={`${a.label} banner`}
                className={`h-7 w-7 rounded-full border-2 transition ${accent === a.key ? 'border-white scale-110' : 'border-white/40'}`}
                style={{ backgroundColor: a.color }}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => window.print()}>
              <Printer size={16} /> Print / Save as PDF
            </button>
            <button className="btn-ghost bg-white/90" onClick={onClose}>
              <X size={16} /> Close
            </button>
          </div>
        </div>

        {/* ── The poster (A4 portrait) ── */}
        <div id="sos-poster" className="relative overflow-hidden bg-black" style={{ aspectRatio: '1 / 1.414' }}>
          {/* watermark */}
          <div
            className="pointer-events-none absolute inset-0 grid place-items-center opacity-[0.13]"
            style={{ fontSize: 'min(46vw, 300px)', color: '#fff', fontWeight: 900, letterSpacing: '-0.05em' }}
            aria-hidden
          >
            SOS
          </div>

          <div className="relative flex h-full flex-col px-[6%] py-[5%]">
            <div className="-mx-[6%] px-[6%] py-[3%]" style={{ backgroundColor: theme.color }}>
              <h1 className="text-[clamp(20px,6.2vw,44px)] font-black uppercase leading-[1.05] tracking-tight" style={{ color: theme.text }}>
                There&rsquo;s safety in numbers
              </h1>
            </div>

            <p className="mt-[7%] text-[clamp(8px,2.1vw,15px)] font-bold uppercase tracking-wide text-white">
              Contact the number below in case of emergency
            </p>

            <table className="mt-[4%] w-full border-collapse text-white" style={{ border: `1px solid ${theme.color}` }}>
              <tbody>
                <tr>
                  <td colSpan={3} className="px-2 py-[3%] text-center text-[clamp(12px,3.4vw,26px)] font-bold" style={{ border: `1px solid ${theme.color}` }}>
                    {site.name}
                  </td>
                </tr>
                <tr className="text-[clamp(9px,2.4vw,18px)] font-bold">
                  <td className="w-[28%] px-2 py-[2%] text-center" style={{ border: `1px solid ${theme.color}` }}>Department</td>
                  <td className="w-[24%] px-2 py-[2%] text-center" style={{ border: `1px solid ${theme.color}` }}>Primary</td>
                  <td className="px-2 py-[2%] text-center" style={{ border: `1px solid ${theme.color}` }}>Secondary</td>
                </tr>
                {rows.map((r) => (
                  <tr key={r.dept}>
                    <td className="px-2 py-[4.5%] text-center text-[clamp(9px,2.4vw,18px)] font-bold" style={{ border: `1px solid ${theme.color}` }}>
                      {r.dept}
                    </td>
                    <td className="px-2 text-center text-[clamp(10px,2.7vw,20px)] font-bold" style={{ border: `1px solid ${theme.color}` }}>
                      {NATIONAL[r.dept]}
                    </td>
                    <td className="px-2 text-center leading-tight" style={{ border: `1px solid ${theme.color}` }}>
                      {r.contact ? (
                        <>
                          <div className="text-[clamp(9px,2.3vw,17px)] font-bold">{r.contact.name}</div>
                          {r.contact.phone ? (
                            <div className="text-[clamp(9px,2.4vw,18px)] font-bold">{r.contact.phone}</div>
                          ) : (
                            // Never leave a blank under a station name on a printed
                            // poster — say to use the national line instead.
                            <div className="text-[clamp(7px,1.9vw,13px)] italic text-white/60">
                              No direct line — dial {NATIONAL[r.dept]}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-[clamp(8px,2vw,14px)] italic text-white/50">Not mapped — use “Map nearest”</span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="px-2 py-[2.5%] text-center text-[clamp(7px,1.9vw,14px)] font-bold leading-tight" style={{ border: `1px solid ${theme.color}` }}>
                    Safety &amp; Security<br />(Help Line)
                  </td>
                  <td className="px-2 text-center text-[clamp(9px,2.4vw,18px)] font-bold" style={{ border: `1px solid ${theme.color}` }}>
                    {helpline.primary || '—'}
                  </td>
                  <td className="px-2 text-center text-[clamp(9px,2.4vw,18px)] font-bold" style={{ border: `1px solid ${theme.color}` }}>
                    {helpline.secondary || '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {!helpline.primary && !helpline.secondary && (
          <p className="mt-2 text-center text-xs text-white/70 print:hidden">
            Set your org-wide Safety &amp; Security helpline in{' '}
            {isAdmin
              ? <Link to="/settings" className="font-semibold underline">Org Settings → General</Link>
              : <b>Org Settings → General</b>}
            {' '}— it prints on every site&apos;s poster.
          </p>
        )}
      </div>
    </div>
  )
}
