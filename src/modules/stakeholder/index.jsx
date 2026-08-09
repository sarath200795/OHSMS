import { Routes, Route, Navigate, NavLink } from 'react-router-dom'
import { LayoutGrid, MessageSquareWarning, Gavel } from 'lucide-react'
import { StakeholderProvider } from './context/StakeholderContext'
import Hub from './pages/Hub'
import Escalations from './pages/Escalations'
import EscalationForm from './pages/EscalationForm'
import LegalIssues from './pages/LegalIssues'
import LegalIssueForm from './pages/LegalIssueForm'

// Stakeholder Issues — what customers escalated, and what authorities did about
// it. Two records rather than one with a type field: they are owned by
// different people and answer different questions, but a legal issue can name
// the complaint it came from, and that crossover is the point of the module.
const TABS = [
  { to: '/stakeholder', end: true, label: 'Overview', icon: LayoutGrid },
  { to: '/stakeholder/escalations', label: 'Customer Escalations', icon: MessageSquareWarning },
  { to: '/stakeholder/legal', label: 'Legal Issues', icon: Gavel },
]

export default function StakeholderModule() {
  return (
    <StakeholderProvider>
      <nav className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
                isActive ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
              }`
            }
          >
            <t.icon size={14} /> {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Hub />} />
        <Route path="escalations" element={<Escalations />} />
        {/* Full pages, not modals — see EscalationForm for why. Their own
            routes so a half-filled form survives a refresh and can be linked. */}
        <Route path="escalations/new" element={<EscalationForm />} />
        <Route path="escalations/:id" element={<EscalationForm />} />
        <Route path="legal" element={<LegalIssues />} />
        <Route path="legal/new" element={<LegalIssueForm />} />
        <Route path="legal/:id" element={<LegalIssueForm />} />
        <Route path="*" element={<Navigate to="/stakeholder" replace />} />
      </Routes>
    </StakeholderProvider>
  )
}
