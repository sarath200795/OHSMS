import { Link } from 'react-router-dom'
import { useAlertFeedContext } from '../../shared/mobile/alertContext'

function when(at) {
  if (!at) return ''
  const mins = Math.round((Date.now() - at) / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export default function Alerts() {
  const { items, unread, ready, markRead, markAllRead } = useAlertFeedContext()

  return (
    <div className="mx-auto max-w-md">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-ink-900">Alerts</h1>
          <p className="mt-1 text-sm text-ink-500">
            {ready && unread > 0
              ? `${unread} unread across the sites you can see.`
              : 'New defects, weather, incidents, meetings and drills.'}
          </p>
        </div>
        <button
          type="button"
          onClick={markAllRead}
          disabled={!unread}
          className="min-h-12 flex-none rounded-2xl px-3 text-[13px] font-semibold text-brand-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:text-ink-300 disabled:no-underline"
        >
          Mark all read
        </button>
      </div>

      {!ready && (
        <p className="mt-6 text-sm text-ink-500" role="status">
          Loading alerts…
        </p>
      )}

      {ready && items.length === 0 && (
        <p className="mt-6 rounded-2xl bg-white px-4 py-8 text-center text-sm text-ink-500 ring-1 ring-ink-200">
          Nothing new on the sites you can see.
        </p>
      )}

      <ul className="mt-4 flex flex-col gap-2">
        {items.map((row) => (
          <li
            key={row.id}
            className="flex items-stretch gap-1 rounded-2xl bg-white ring-1 ring-ink-200"
          >
            <Link
              to={row.to}
              onClick={() => {
                if (row.unread) markRead(row.id)
              }}
              className="flex min-h-14 min-w-0 flex-1 flex-col justify-center px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400"
            >
              <span className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-ink-400">
                  {row.kind}
                </span>
                {row.unread && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-800">
                    New
                  </span>
                )}
              </span>
              <span className="mt-0.5 truncate text-[15px] font-semibold text-ink-900">
                {row.title}
              </span>
              <span className="truncate text-[12px] text-ink-500">
                {[row.detail, when(row.at)].filter(Boolean).join(' · ')}
              </span>
            </Link>
            {row.unread && (
              <button
                type="button"
                onClick={() => markRead(row.id)}
                className="min-h-12 flex-none self-center px-3 text-[12px] font-semibold text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                Mark read
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
