import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { fieldApps } from '../mobile/appGrid'

/**
 * iPhone-style home. One rounded tile per place this person can open.
 *
 * The heading is for the accessibility tree. On the portal the desktop h1 is
 * `display: none` below `md`, so this is the phone's only heading; on desktop
 * this whole grid is the one that is hidden.
 */
export default function FieldAppGrid() {
  const { moduleMap, role } = useAuth()
  const apps = fieldApps({ moduleMap, role })

  return (
    <div>
      <h1 className="sr-only">Home</h1>
      <ul className="grid grid-cols-4 gap-x-3 gap-y-5">
        {apps.map((app) => (
          <li key={app.key}>
            <Link
              to={app.to}
              className="flex flex-col items-center gap-1.5 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
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
    </div>
  )
}
