// Page header: liquid-glass icon disc + title + subtitle, with an optional
// actions slot on the right.
import { ModuleMark } from '../../../shared/ui'

export default function PageHeader({ icon, title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {icon && (
          <ModuleMark tone="amber" size="sm">
            {icon}
          </ModuleMark>
        )}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-steel-50">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-steel-400">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

// Small inline icon helper so pages can pass consistent stroke icons.
export const HdrIcon = ({ d }) => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {d}
  </svg>
)
