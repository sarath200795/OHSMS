import { NavLink } from 'react-router-dom'

/**
 * Secondary nav used by every module.
 *
 * There used to be a copy of this in each module's index, and three of them
 * (CCTV, stakeholder, objectives) had drifted into a different look — dark
 * pills vs filled chips vs brand fill — so moving between modules felt like
 * changing products. One component, one active state, and a phone can scroll
 * the row sideways instead of wrapping it into a tall stack of tabs.
 *
 * `toFor` exists for CCTV: the site filter lives in the query string and a
 * bare `to` would drop it on every tab change.
 * `active` on a tab exists for Emergency Response, whose site-detail URLs
 * sit under the first tab without matching `end`.
 */
export default function ModuleTabs({ tabs, label = 'Module sections', toFor, className = '' }) {
  return (
    <nav
      aria-label={label}
      className={`mb-5 flex gap-1 overflow-x-auto overscroll-x-contain border-b border-ink-200 print:hidden [-webkit-overflow-scrolling:touch] ${className}`}
    >
      {tabs
        .filter((t) => !t.hidden)
        .map((t) => (
          <NavLink
            key={t.to}
            to={toFor ? toFor(t.to) : t.to}
            end={t.end}
            className={({ isActive }) => {
              const active = t.active != null ? t.active : isActive
              return [
                'nav-tab',
                active
                  ? 'nav-tab-active -mb-px rounded-b-none border-b-2 border-brand-600'
                  : 'nav-tab-idle',
              ].join(' ')
            }}
          >
            {t.icon ? <t.icon size={16} /> : null}
            {t.label}
          </NavLink>
        ))}
    </nav>
  )
}
