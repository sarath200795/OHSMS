import { forwardRef, useId, useState } from 'react'
import { Field, Input as BaseInput } from '../../../../shared/ui'

/**
 * Labeled input. Field chrome and the control itself are the shared primitives;
 * the leading icon slot and the password reveal are local, since the shared
 * Input is a bare control by design.
 */
const Input = forwardRef(function Input(
  { label, type = 'text', error, hint, icon, className = '', id, ...props },
  ref,
) {
  const [show, setShow] = useState(false)
  const generatedId = useId()
  const inputId = id || props.name || generatedId
  const isPassword = type === 'password'
  const resolvedType = isPassword ? (show ? 'text' : 'password') : type

  return (
    <Field label={label} htmlFor={inputId} hint={hint} error={error}>
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">
            {icon}
          </span>
        )}
        <BaseInput
          ref={ref}
          id={inputId}
          type={resolvedType}
          className={`${icon ? 'pl-10' : ''} ${isPassword ? 'pr-12' : ''} ${
            error ? 'border-red-300 focus:border-red-400 focus:ring-red-200' : ''
          } ${className}`}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-400 hover:text-brand-600"
            tabIndex={-1}
          >
            {show ? 'HIDE' : 'SHOW'}
          </button>
        )}
      </div>
    </Field>
  )
})

export default Input
