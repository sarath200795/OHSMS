import { forwardRef } from 'react'

/**
 * Labeled input with an optional leading icon, matching the portal's soft,
 * rounded field style.
 */
const Input = forwardRef(function Input(
  { label, icon: Icon, error, hint, action, className = '', id, ...props },
  ref,
) {
  const inputId = id || props.name
  return (
    <div className={className}>
      {(label || action) && (
        <div className="mb-1.5 flex items-center justify-between">
          {label && (
            <label htmlFor={inputId} className="field-label !mb-0">
              {label}
            </label>
          )}
          {action}
        </div>
      )}
      <div className="relative">
        {Icon && (
          <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        )}
        <input
          ref={ref}
          id={inputId}
          className={`input-base ${Icon ? '' : '!pl-4'} ${
            error ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-400/30' : ''
          }`}
          {...props}
        />
      </div>
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-rose-600">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-slate-400">{hint}</p>
      ) : null}
    </div>
  )
})

export default Input
