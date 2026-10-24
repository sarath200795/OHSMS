import { Link } from 'react-router-dom'
import FieldLaunchpad from '../../shared/layout/FieldLaunchpad'

export default function FieldHome() {
  return (
    <div className="mx-auto max-w-md">
      <FieldLaunchpad />
      <p className="mt-6 text-center text-sm text-ink-500">
        <Link
          to="/portal"
          className="font-semibold text-brand-700 underline-offset-2 hover:underline"
        >
          Full workspace
        </Link>
        <span> — the desktop home, with every module.</span>
      </p>
    </div>
  )
}
