import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { fieldApps, groupFieldApps } from '../mobile/appGrid'
import { ViewModeSwitch } from '../mobile/viewModeContext'

/**
 * iPhone-style home. One rounded tile per place this person can open,
 * under Technical and — only when they have one — Admin.
 *
 * The page heading is for the accessibility tree. Portal home renders this
 * grid or the desktop dashboard, never both, so this is the only heading
 * while mobile view is on. The switch above the groups is the same control
 * the desktop home renders.
 *
 * Tiles stagger in and shrink under a finger. Both are cancelled when the
 * OS asks for reduced motion, so a tile never starts invisible.
 */
export default function FieldAppGrid() {
  const { moduleMap, role } = useAuth()
  const sections = groupFieldApps(fieldApps({ moduleMap, role }))

  return (
    <div className="space-y-7">
      <h1 className="sr-only">Home</h1>
      <ViewModeSwitch />
      {sections.map((section) => (
        <section key={section.key} aria-labelledby={`field-section-${section.key}`}>
          <h2
            id={`field-section-${section.key}`}
            className="mb-3 text-[13px] font-bold tracking-[-0.01em] text-ink-500"
          >
            {section.label}
          </h2>
          <ul className="grid grid-cols-4 gap-x-3 gap-y-5">
            {section.apps.map((app, i) => (
              <li
                key={app.key}
                className="field-tile-in"
                style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
              >
                <Link
                  to={app.to}
                  className="field-tile-press flex flex-col items-center gap-1.5 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas active:scale-[0.92] motion-reduce:active:scale-100"
                >
                  <span
                    className={`grid h-[60px] w-[60px] place-items-center rounded-[18px] text-white shadow-elev-sm ${app.fill}`}
                  >
                    <app.icon size={28} strokeWidth={2.25} aria-hidden="true" />
                  </span>
                  <span className="line-clamp-2 w-full text-center text-[11px] font-semibold leading-tight text-ink-800">
                    {app.label}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
