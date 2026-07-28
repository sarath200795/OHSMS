// ─────────────────────────────────────────────────────────────────────────────
// Skeleton loading placeholders. A shimmering bar/box plus page-shaped layouts
// (table, KPI cards) that mirror the real content so the swap-in is seamless.
// Uses the existing `shimmer` keyframe (tailwind.config.js) over a clay base.
// ─────────────────────────────────────────────────────────────────────────────

/** A single shimmering placeholder block. */
export function Skeleton({ className = '' }) {
  return (
    <span
      aria-hidden="true"
      className={`relative block overflow-hidden rounded-md bg-clay-200/70 ${className}`}
    >
      <span className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    </span>
  )
}

/** A skeleton shaped like the shared ExtinguisherTable / bespoke tables. */
export function TableSkeleton({ rows = 6, cols = 6, className = '' }) {
  return (
    <div className={`card overflow-hidden ${className}`} aria-busy="true" aria-label="Loading">
      {/* header */}
      <div className="flex gap-4 bg-clay-100/70 px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {/* rows */}
      <div className="divide-y divide-clay-200/60">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3.5">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} className={`h-4 flex-1 ${c === 0 ? 'max-w-[160px]' : ''}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** A grid of KPI-card skeletons (Dashboard). */
export function KpiSkeleton({ count = 7 }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-7" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-5">
          <Skeleton className="mb-3 h-11 w-11 rounded-xl" />
          <Skeleton className="mb-2 h-7 w-16" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  )
}

/** A row of chart-card skeletons. */
export function ChartSkeleton({ count = 3 }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-5">
          <Skeleton className="mb-1 h-4 w-32" />
          <Skeleton className="mb-4 h-3 w-40" />
          <Skeleton className="mx-auto h-44 w-44 rounded-full" />
        </div>
      ))}
    </div>
  )
}

/** Toolbar/filter-bar skeleton to sit above a table. */
export function FilterBarSkeleton() {
  return (
    <div className="card mb-4 flex flex-wrap items-center gap-3 p-4" aria-busy="true">
      <Skeleton className="h-9 min-w-[200px] flex-1 rounded-2xl" />
      <Skeleton className="h-9 w-28 rounded-2xl" />
      <Skeleton className="h-9 w-28 rounded-2xl" />
      <Skeleton className="h-9 w-28 rounded-2xl" />
    </div>
  )
}
