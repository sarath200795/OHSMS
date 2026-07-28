import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Button } from '../shared/ui'

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-clay-bg p-4">
      <div className="card flex max-w-md flex-col items-center gap-4 p-10 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-clay-100 text-ink-400 shadow-clay-inset">
          <Compass size={30} />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Page not found</h1>
          <p className="mt-1 text-sm text-ink-500">The page you&apos;re looking for doesn&apos;t exist.</p>
        </div>
        <Button as={Link} to="/dashboard">
          Back to dashboard
        </Button>
      </div>
    </div>
  )
}
