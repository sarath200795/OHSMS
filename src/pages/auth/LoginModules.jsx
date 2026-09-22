// ─────────────────────────────────────────────────────────────────────────────
// Public module roster on the sign-in screen.
//
// A line list, not tiles. Registry descriptions are for the signed-in
// dashboard; here each module is one line (mark, name, brief) so the form and
// the list still share a viewport. The roster sits in its own frost pane.
// Lines slide in, a wash travels the list, and a sheen crosses the pane.
// motion-reduce drops the motion; the glass stays.
// ─────────────────────────────────────────────────────────────────────────────
import { motion, useReducedMotion } from 'framer-motion'
import { MODULES } from '../../shared/modules/registry'
import { loginBrief } from './loginBriefs'

export default function LoginModules() {
  const reduce = useReducedMotion()
  return (
    <section
      aria-labelledby="login-modules-heading"
      className="login-glass mx-auto w-full max-w-md rounded-3xl px-3 py-2.5 lg:mx-0"
    >
      <h2
        id="login-modules-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700"
      >
        Modules
      </h2>
      <ul className="mt-1.5 list-none p-0">
        {MODULES.map((m, i) => {
          const Icon = m.icon
          return (
            <motion.li
              key={m.key}
              className="login-line flex items-center gap-2 px-1.5 py-1 text-[12.5px] leading-tight"
              style={{ animationDelay: `${i * 1.25}s` }}
              initial={reduce ? false : { opacity: 0, x: 18 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                duration: 0.45,
                delay: reduce ? 0 : i * 0.045,
                ease: [0.23, 1, 0.32, 1],
              }}
            >
              <span
                data-tone={m.tone}
                className="glass-mark h-5 w-5 shrink-0 rounded-md transition-transform duration-200"
                aria-hidden="true"
              >
                <Icon size={11} strokeWidth={2.2} className="block" />
              </span>
              <span className="shrink-0 font-semibold text-ink-900">{m.label}</span>
              <span className="min-w-0 truncate text-ink-500">{loginBrief(m)}</span>
            </motion.li>
          )
        })}
      </ul>
    </section>
  )
}
