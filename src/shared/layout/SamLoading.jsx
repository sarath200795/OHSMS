import { useEffect, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import SamCharacter3D from '../sam/SamCharacter3D'

/**
 * Sam waiting while the app boots.
 *
 * This is the first thing anyone sees after signing in, and a bare spinner
 * spends that moment saying nothing. Sam is already the app's guide on every
 * other screen; having him wait with you costs nothing and makes the pause feel
 * like part of the product rather than a gap in it.
 *
 * He paces rather than stands still — `walking` is the rig's own animation, so
 * this is not a second implementation of him.
 */

// Rotated slowly so a long wait is not the same six words over and over. Each
// says something true about what is happening rather than inventing progress.
const LINES = [
  'Getting your workspace ready…',
  'Loading your sites and permissions…',
  'Almost there…',
]

export default function SamLoading({ label }) {
  const reduce = useReducedMotion()
  const [line, setLine] = useState(0)

  useEffect(() => {
    // Only rotate if the wait is long enough to notice. A fast load shows the
    // first line and nothing else, which is the common case.
    const t = setInterval(() => setLine((i) => Math.min(i + 1, LINES.length - 1)), 2600)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="grid min-h-screen place-items-center bg-clay-bg">
      <div className="flex flex-col items-center gap-4">
        <SamCharacter3D walking={!reduce} talking={false} reduce={reduce} size={96} />

        <div className="text-center">
          <p className="text-sm font-semibold text-ink-700">{label || LINES[line]}</p>
          {/* A bar that fills without claiming a percentage — there is no real
              progress to report, and a fake number is worse than none. */}
          <div className="mx-auto mt-3 h-1 w-40 overflow-hidden rounded-full bg-ink-200">
            <div className="h-full w-1/3 rounded-full bg-brand-500 motion-safe:animate-[shimmer_1.8s_infinite] motion-reduce:w-full" />
          </div>
        </div>
      </div>
    </div>
  )
}
