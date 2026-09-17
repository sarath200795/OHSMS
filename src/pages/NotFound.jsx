import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Button } from '../shared/ui'

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-clay-bg p-4">
      <div className="card flex max-w-md flex-col items-center gap-4 p-10 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-xl bg-clay-100 text-ink-400 ring-1 ring-ink-900/5">
          <Compass size={28} />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Page not found</h1>
          <p className="mt-1 text-sm text-ink-500">
            The page you&apos;re looking for doesn&apos;t exist.
          </p>
        </div>
        <Button as={Link} to="/portal">
          Back to home
        </Button>
      </div>
    </div>
  )
}
