import { forwardRef, useId } from 'react'
import { Field, Input as BaseInput } from '../../../../shared/ui'

/**
 * Labeled input with an optional leading icon. The field itself and its
 * label/hint/error chrome are the shared primitives; only the icon overlay is
 * local, because the shared Input is a bare control by design.
 */
const Input = forwardRef(function Input(
  { label, icon: Icon, error, hint, action, className = '', id, ...props },
  ref,
) {
  const generatedId = useId()
  const inputId = id || props.name || generatedId
  return (
    <Field
      className={className}
      label={label}
      htmlFor={inputId}
      hint={hint}
      error={error}
      action={action}
    >
      <div className="relative">
        {Icon && (
          <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        )}
        <BaseInput
          ref={ref}
          id={inputId}
          className={`${Icon ? 'pl-10' : ''} ${
            error ? 'border-red-300 focus:border-red-400 focus:ring-red-200' : ''
          }`}
          {...props}
        />
      </div>
    </Field>
  )
})

export default Input
