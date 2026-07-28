import { forwardRef } from 'react'
import { ChevronDown } from 'lucide-react'

const Select = forwardRef(function Select(
  { label, icon: Icon, error, className = '', id, children, ...props },
  ref,
) {
  const selectId = id || props.name
  return (
    <div className={className}>
      {label && (
        <label htmlFor={selectId} className="field-label">
          {label}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        )}
        <select
          ref={ref}
          id={selectId}
          className={`input-base appearance-none pr-10 ${Icon ? '' : '!pl-4'} ${
            error ? 'border-rose-300' : ''
          }`}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>
      {error && (
        <p className="mt-1.5 text-xs font-medium text-rose-600">{error}</p>
      )}
    </div>
  )
})

export default Select
