// ─────────────────────────────────────────────────────────────────────────────
// The route half of module entitlements.
//
// Hiding a tile is presentation. This is the part that matters: a bookmark, a
// link in an old email, or a typed URL must not walk into a module the
// organization has not been given. Firestore rules stop the data leaving, but
// an unguarded route would still mount the module and show its empty shell with
// a permission error behind it — which reads as a broken product rather than an
// absent one.
//
// A screen, not a redirect. Someone who followed a link to /loto deserves to be
// told the module is not switched on for their organization; being bounced to
// the home page with no explanation is how a person concludes the link is
// broken and asks IT to fix nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { MODULE_BY_KEY } from './registry'
import ModuleLoading from '../layout/ModuleLoading'
import { Card, Button } from '../ui'

export default function ModuleGate({ moduleKey, children }) {
  const { moduleEnabled, modulesReady } = useAuth()

  // Entitlements default to "everything on", so rendering the module while the
  // document is still in flight would flash it into view and then take it away.
  // The wait is a single document read against a warm connection.
  if (!modulesReady) return <ModuleLoading />
  if (moduleEnabled(moduleKey)) return children

  const mod = MODULE_BY_KEY[moduleKey]

  return (
    <Card className="mx-auto max-w-lg p-8 text-center">
      <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-ink-100 text-ink-500">
        <Lock size={22} />
      </span>
      <h2 className="text-lg font-bold text-ink-900">
        {mod?.title || 'This module'} is not enabled
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-[14px] text-ink-500">
        Your organization does not currently have access to this module. Ask your administrator
        to request it — nothing here is missing or broken.
      </p>
      <Button as={Link} to="/portal" className="mt-6">
        Back to home
      </Button>
    </Card>
  )
}
