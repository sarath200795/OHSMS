// ─────────────────────────────────────────────────────────────────────────────
// Module marks drifting behind the sign-in glass.
//
// They live inside `.login-stage` (not outside the motion wrapper) so the
// frost panes' backdrop-filter actually samples them. Low opacity, a slow bob,
// and pointer-events none — the form and the line briefs stay the thing you
// read. Reduced motion leaves them still.
// ─────────────────────────────────────────────────────────────────────────────
import { MODULES } from '../../shared/modules/registry'

// Scattered so they ring the stage rather than sitting in one clump. Duration
// and delay differ per mark so the field does not bob in lockstep.
const SPOTS = [
  ['4%', '2%', 56, '0s', '18s'],
  ['22%', '10%', 36, '-3s', '14s'],
  ['70%', '0%', 44, '-6s', '16s'],
  ['88%', '14%', 32, '-1s', '20s'],
  ['8%', '38%', 28, '-8s', '15s'],
  ['0%', '62%', 48, '-4s', '17s'],
  ['16%', '86%', 34, '-9s', '19s'],
  ['62%', '90%', 50, '-2s', '13s'],
  ['90%', '58%', 30, '-7s', '16s'],
  ['46%', '4%', 26, '-5s', '18s'],
  ['96%', '36%', 40, '-11s', '15s'],
  ['38%', '94%', 28, '-2.5s', '21s'],
  ['12%', '52%', 24, '-10s', '14s'],
  ['58%', '8%', 34, '-1.5s', '17s'],
  ['30%', '24%', 22, '-6.5s', '19s'],
  ['76%', '30%', 26, '-3.5s', '16s'],
  ['48%', '72%', 30, '-8.5s', '18s'],
]

export default function LoginFloatLogos() {
  return (
    <div className="login-float" aria-hidden="true">
      {MODULES.map((m, i) => {
        const Icon = m.icon
        const [top, left, size, delay, duration] = SPOTS[i] || SPOTS[0]
        return (
          <span
            key={m.key}
            data-tone={m.tone}
            className="glass-mark login-float-mark"
            style={{
              top,
              left,
              width: size,
              height: size,
              animationDelay: delay,
              animationDuration: duration,
            }}
          >
            <Icon size={Math.round(size * 0.46)} strokeWidth={1.75} />
          </span>
        )
      })}
    </div>
  )
}
