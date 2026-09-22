import { motion, useReducedMotion } from 'framer-motion'
import BrandMark from '../../shared/branding/BrandMark'

/**
 * Shared chrome for public auth screens (sign-in, register, forgot password).
 *
 * `showcase` is the optional right-hand / below column — the sign-in page uses
 * it for the module roster. Other auth routes stay the narrow centred card so
 * a password reset is not buried under seventeen glass tiles.
 */
export default function AuthLayout({ title, subtitle, children, footer, showcase }) {
  const reduce = useReducedMotion()
  const brand = (
    <div className="mb-6 flex flex-col items-center text-center">
      <BrandMark className="mb-3" alt="WEHS" />
      <h1 className="text-2xl font-bold tracking-[-0.02em] text-ink-900">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
    </div>
  )
  const panel = (
    <>
      {brand}
      <div className="card p-6 sm:p-8">{children}</div>
      {footer && <div className="mt-5 text-center text-sm text-ink-600">{footer}</div>}
    </>
  )

  return (
    <div className="aurora min-h-screen px-4 py-8 sm:py-12">
      <motion.div
        className={`mx-auto w-full ${showcase ? 'max-w-6xl' : 'max-w-md'}`}
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
      >
        {showcase ? (
          <div className="grid gap-8 lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] lg:items-start">
            <div className="mx-auto w-full max-w-md lg:mx-0 lg:sticky lg:top-8">{panel}</div>
            {showcase}
          </div>
        ) : (
          <div className="mx-auto w-full max-w-md">{panel}</div>
        )}
      </motion.div>
    </div>
  )
}
