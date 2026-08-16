import { forwardRef, useId } from 'react'
import { ChevronDown } from 'lucide-react'
import { Field, Select as BaseSelect } from '../../../../shared/ui'

/**
 * Labeled select. Shared field chrome and control; the icon overlays and the
 * chevron are local, since the shared Select is a bare control (it reserves the
 * right-hand padding but draws no arrow of its own).
 */
const Select = forwardRef(function Select(
  { label, icon: Icon, error, className = '', id, children, ...props },
  ref,
) {
  const generatedId = useId()
  const selectId = id || props.name || generatedId
  return (
    <Field className={className} label={label} htmlFor={selectId} error={error}>
      <div className="relative">
        {Icon && (
          <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        )}
        <BaseSelect
          ref={ref}
          id={selectId}
          className={`${Icon ? 'pl-10' : ''} ${error ? 'border-red-300' : ''}`}
          {...props}
        >
          {children}
        </BaseSelect>
        <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      </div>
    </Field>
  )
})

export default Select
