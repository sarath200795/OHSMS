import { motion } from 'framer-motion'

// Claymorphism buttons: puffy, rounded, soft clay shadow, pressed-in on tap.
const VARIANTS = {
  primary: 'bg-hazard text-ink hover:bg-hazard-dark shadow-clay',
  danger: 'bg-danger text-white hover:brightness-95 shadow-clay',
  ghost: 'bg-claySurface text-steel-200 hover:bg-steel-800 shadow-sm',
  steel: 'bg-steel-800 text-steel-100 hover:bg-steel-700 shadow-clay',
}

const SIZES = {
  sm: 'px-3.5 py-1.5 text-sm',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-6 py-3 text-base',
}

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className = '',
  type = 'button',
  ...props
}) {
  const isDisabled = disabled || loading
  return (
    <motion.button
      type={type}
      whileTap={isDisabled ? {} : { scale: 0.97 }}
      transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
      disabled={isDisabled}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition-[background-color,box-shadow,color] duration-150 ease-out-strong active:shadow-clay-inset disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </motion.button>
  )
}
