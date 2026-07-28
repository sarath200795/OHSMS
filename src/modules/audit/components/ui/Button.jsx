import { Loader2 } from 'lucide-react'

const VARIANTS = {
  primary:
    'bg-brand-600 text-white shadow-brand hover:bg-brand-700 active:bg-brand-800',
  secondary:
    'bg-white text-ink-800 border border-slate-200 hover:bg-slate-50',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100',
  danger:
    'bg-rose-500 text-white hover:bg-rose-600 shadow-sm',
  subtle: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
}

const SIZES = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-5 py-3 text-sm',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  iconRight: IconRight,
  className = '',
  children,
  disabled,
  ...props
}) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        Icon && <Icon className="h-4 w-4" />
      )}
      {children}
      {IconRight && !loading && <IconRight className="h-4 w-4" />}
    </button>
  )
}
