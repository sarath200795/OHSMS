import Card from './ui/Card'

// "All caught up" style empty state — centered tile + heading + subtext.
export default function EmptyState({ title = 'All caught up', subtitle, icon }) {
  return (
    <Card className="!p-12 text-center">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-clay text-steel-400 shadow-clay-inset">
        {icon || (
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </span>
      <p className="mt-4 text-lg font-bold text-steel-100">{title}</p>
      {subtitle && <p className="mt-1 text-sm text-steel-400">{subtitle}</p>}
    </Card>
  )
}
