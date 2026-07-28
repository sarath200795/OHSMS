export default function EmptyState({ icon: Icon, title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/50 px-6 py-14 text-center">
      {Icon && (
        <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400">
          <Icon className="h-7 w-7" />
        </span>
      )}
      <h3 className="text-base font-bold text-ink-800">{title}</h3>
      {message && (
        <p className="mt-1 max-w-sm text-sm text-slate-500">{message}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
