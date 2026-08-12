import { TriangleAlert } from 'lucide-react'

/**
 * "These figures are incomplete."
 *
 * Rendered wherever a total is built from a capped or failed read. It takes the
 * object incompleteReadNotice() produces and renders nothing when that is null,
 * so a caller can drop it in unconditionally and it stays invisible until there
 * is something to say.
 *
 * It belongs ABOVE the numbers it qualifies, not below them: someone scanning a
 * dashboard reads the figure and moves on, and a caveat underneath arrives
 * after the decision has already been made.
 */
export default function IncompleteNotice({ incomplete, className = '' }) {
  if (!incomplete) return null
  return (
    <div
      role="status"
      className={`flex items-start gap-2.5 rounded-2xl bg-amber-50 px-4 py-3 shadow-clay-sm ${className}`}
    >
      <TriangleAlert size={16} className="mt-0.5 flex-none text-amber-700" />
      <p className="text-[12.5px] leading-relaxed text-amber-900">
        <b>These figures are incomplete.</b> {incomplete.message}
      </p>
    </div>
  )
}
