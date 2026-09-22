// ─────────────────────────────────────────────────────────────────────────────
// Public module roster on the sign-in screen.
//
// A line list, not tiles, and short on purpose. The registry descriptions are
// written for the signed-in dashboard, where a paragraph has room. Pasting
// them here made the sign-in page ramble below the fold. Login shows one line
// per module (name — brief) in a narrow column beside the form. Anything
// missing from LOGIN_BRIEF falls back to the registry text so a new module
// cannot appear nameless.
// ─────────────────────────────────────────────────────────────────────────────
import { MODULES } from '../../shared/modules/registry'

/** One line each — enough to say what the module is for, not how it works. */
const LOGIN_BRIEF = {
  incidents: 'Report, investigate, track CAPA',
  hira: 'Hazard register and risk matrix',
  inspections: 'Checklists and findings',
  audit: 'ISO 45001 plans and actions',
  ptw: 'Raise, approve, close permits',
  loto: 'Energy isolation records',
  equipment: 'Extinguishers, AEDs, alarms',
  drills: 'Fire and emergency drills',
  committee: 'Meetings, minutes, actions',
  training: 'Courses and expiry alerts',
  documents: 'Policies, SOPs, and SDS',
  emergency: 'Contacts and evacuation plans',
  objectives: 'OH&S targets and scorecard',
  weather: 'Site conditions as work risk',
  cctv: 'Cameras, recorders, and health',
  stakeholder: 'Escalations and legal matters',
  actions: 'Open actions across modules',
}

export function loginBrief(module) {
  return LOGIN_BRIEF[module.key] || module.description
}

export default function LoginModules() {
  return (
    <section aria-labelledby="login-modules-heading" className="mx-auto w-full max-w-md lg:mx-0">
      <h2
        id="login-modules-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700"
      >
        Modules
      </h2>
      <ul className="mt-1.5 list-none p-0">
        {MODULES.map((m) => (
          <li
            key={m.key}
            className="flex items-baseline gap-x-2 border-b border-ink-200/40 py-1 text-[12.5px] leading-tight last:border-b-0"
          >
            <span className="shrink-0 font-semibold text-ink-900">{m.label}</span>
            <span className="min-w-0 text-ink-500">{loginBrief(m)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
