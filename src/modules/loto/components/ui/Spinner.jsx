import LockLoader from '../LockLoader'

export default function Spinner({ size = 56, label }) {
  return <LockLoader size={size} label={label} />
}

export function FullScreenLoader({ label = 'Loading…' }) {
  return (
    <div className="hecp-grid-bg flex min-h-screen items-center justify-center">
      <LockLoader size={84} label={label} />
    </div>
  )
}
