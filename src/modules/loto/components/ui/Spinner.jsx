import LockLoader from '../LockLoader'

// Stays local: like the fire extinguisher and HIRA magnifier loaders, this is
// module-branded artwork (a padlock closing on a hasp), not a primitive. The
// shared Spinner is the generic one.
export default function Spinner({ size = 56, label }) {
  return <LockLoader size={size} label={label} />
}

export function FullScreenLoader({ label = 'Loading…' }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-clay-bg">
      <LockLoader size={84} label={label} />
    </div>
  )
}
