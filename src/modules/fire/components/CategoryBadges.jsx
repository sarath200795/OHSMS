import { Badge } from './ui'
import { deriveStatus } from '../lib/extinguisherLogic'
import { CATEGORIES, DEFECT_BY_KEY } from '../lib/constants'

// Look up a display {label,color} for any category key (defect or due flag).
function metaFor(key) {
  if (DEFECT_BY_KEY[key]) return { label: DEFECT_BY_KEY[key].label, color: DEFECT_BY_KEY[key].color }
  const found = Object.values(CATEGORIES).find((c) => c.key === key)
  if (found) return { label: found.label, color: found.color }
  return { label: key, color: '#64748b' }
}

/** Renders the color-coded condition chips for one extinguisher. */
export default function CategoryBadges({ ext, today = new Date(), max }) {
  const d = deriveStatus(ext, today)
  let cats = d.categories
  if (max && cats.length > max) cats = cats.slice(0, max)

  if (cats.length === 0) {
    return <Badge color={CATEGORIES.HEALTHY.color}>Healthy</Badge>
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {cats.map((key) => {
        const m = metaFor(key)
        return (
          <Badge key={key} color={m.color}>
            {m.label}
          </Badge>
        )
      })}
      {max && d.categories.length > max && (
        <span className="chip bg-ink-100 text-ink-500">+{d.categories.length - max}</span>
      )}
    </div>
  )
}
