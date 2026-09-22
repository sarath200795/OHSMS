// ─────────────────────────────────────────────────────────────────────────────
// Module marks drifting behind the sign-in glass.
//
// They live inside `.login-stage` (not outside the motion wrapper) so the
// frost panes' backdrop-filter actually samples them. Icons repeat so the
// field reads full; marks are large but faint. Reduced motion leaves them still.
// ─────────────────────────────────────────────────────────────────────────────
import { MODULES } from '../../shared/modules/registry'

// Two passes over the registry. Sizes are px; duration and delay differ so
// the field does not bob in lockstep.
const SPOTS = [
  ['2%', '0%', 88, '0s', '18s'],
  ['18%', '8%', 64, '-3s', '14s'],
  ['64%', '-2%', 80, '-6s', '16s'],
  ['84%', '12%', 72, '-1s', '20s'],
  ['6%', '34%', 56, '-8s', '15s'],
  ['-2%', '58%', 92, '-4s', '17s'],
  ['14%', '82%', 68, '-9s', '19s'],
  ['58%', '86%', 84, '-2s', '13s'],
  ['88%', '54%', 60, '-7s', '16s'],
  ['42%', '2%', 52, '-5s', '18s'],
  ['94%', '32%', 76, '-11s', '15s'],
  ['34%', '90%', 64, '-2.5s', '21s'],
  ['10%', '48%', 48, '-10s', '14s'],
  ['54%', '6%', 70, '-1.5s', '17s'],
  ['26%', '20%', 56, '-6.5s', '19s'],
  ['72%', '26%', 62, '-3.5s', '16s'],
  ['46%', '68%', 78, '-8.5s', '18s'],
  ['8%', '16%', 74, '-12s', '22s'],
  ['30%', '42%', 58, '-4.2s', '15s'],
  ['78%', '46%', 86, '-7.2s', '19s'],
  ['20%', '70%', 66, '-1.8s', '16s'],
  ['50%', '22%', 54, '-9.4s', '20s'],
  ['92%', '74%', 70, '-5.6s', '14s'],
  ['38%', '56%', 48, '-3.2s', '17s'],
  ['66%', '64%', 82, '-8.8s', '21s'],
  ['4%', '78%', 60, '-6.1s', '18s'],
  ['82%', '4%', 58, '-2.8s', '15s'],
  ['16%', '28%', 90, '-10.4s', '19s'],
  ['60%', '40%', 52, '-4.8s', '16s'],
  ['44%', '84%', 76, '-7.6s', '22s'],
  ['96%', '18%', 64, '-1.2s', '17s'],
  ['28%', '62%', 68, '-9s', '14s'],
  ['74%', '78%', 56, '-5s', '20s'],
  ['52%', '48%', 44, '-11.5s', '18s'],
]

export default function LoginFloatLogos() {
  const marks = [...MODULES, ...MODULES]
  return (
    <div className="login-float" aria-hidden="true">
      {marks.map((m, i) => {
        const Icon = m.icon
        const [top, left, size, delay, duration] = SPOTS[i] || SPOTS[i % SPOTS.length]
        return (
          <span
            key={`${m.key}-${i}`}
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
            <Icon size={Math.round(size * 0.48)} strokeWidth={1.75} />
          </span>
        )
      })}
    </div>
  )
}
