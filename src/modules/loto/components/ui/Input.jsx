import { forwardRef, useState } from 'react'

const Input = forwardRef(function Input(
  { label, type = 'text', error, hint, icon, className = '', ...props },
  ref,
) {
  const [show, setShow] = useState(false)
  const isPassword = type === 'password'
  const resolvedType = isPassword ? (show ? 'text' : 'password') : type

  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-sm font-medium text-steel-200">
          {label}
        </span>
      )}
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-steel-400">
            {icon}
          </span>
        )}
        <input
          ref={ref}
          type={resolvedType}
          className={`w-full rounded-xl bg-clay px-3.5 py-2.5 text-steel-100 shadow-clay-inset outline-none ring-2 ring-transparent transition-[box-shadow,border-color] duration-200 ease-out-strong focus:ring-hazard/50 ${
            icon ? 'pl-10' : ''
          } ${isPassword ? 'pr-12' : ''} ${error ? 'ring-danger/60' : ''} ${className}`}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-steel-400 hover:text-amber-600"
            tabIndex={-1}
          >
            {show ? 'HIDE' : 'SHOW'}
          </button>
        )}
      </div>
      {error ? (
        <span className="mt-1 block text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-steel-400">{hint}</span>
      ) : null}
    </label>
  )
})

export default Input
