import { Link } from 'react-router-dom'
import { User, Building2 } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'

/**
 * Switch between the two homes: the employee portal and the org modules.
 *
 * Everyone now lands on the portal, which is right for the large majority who
 * only ever report something and check their training. It would strand the
 * people who run the place, so anyone with a role above plain member carries
 * this switch in both shells — the portal header and the admin header — and it
 * looks the same in each, because it is one control that happens to be
 * rendered twice rather than two controls that resemble each other.
 *
 * Plain members never see it: there is no second view to switch to, and a
 * disabled toggle to somewhere they cannot go is worse than no toggle.
 */
export default function ViewSwitch({ view }) {
  const { role } = useAuth()
  if (!role || role === 'member') return null

  const base =
    'inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold transition-colors'
  const on = 'bg-clay-surface text-ink-900 shadow-clay-sm'
  const off = 'text-ink-500 hover:text-ink-800'

  return (
    <div
      className="hidden items-center gap-1 rounded-2xl bg-clay-surface p-1 shadow-clay-inset md:inline-flex"
      role="group"
      aria-label="Switch view"
    >
      <Link to="/portal" className={`${base} ${view === 'personal' ? on : off}`} aria-current={view === 'personal' ? 'page' : undefined}>
        <User size={14} /> Personal
      </Link>
      <Link to="/hub" className={`${base} ${view === 'org' ? on : off}`} aria-current={view === 'org' ? 'page' : undefined}>
        <Building2 size={14} /> Organization
      </Link>
    </div>
  )
}
