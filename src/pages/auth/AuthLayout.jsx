import { motion, useReducedMotion } from 'framer-motion'
import BrandMark from '../../shared/branding/BrandMark'

/**
 * Shared chrome for public auth screens (sign-in, register, forgot password).
 *
 * `showcase` is the optional right-hand / below column — the sign-in page uses
 * it for the module roster. Other auth routes stay the narrow centred card so
 * a password reset is not buried under seventeen glass tiles.
 *
 * On a phone the showcase stacks under the form: tighter chrome and a hairline
 * before the briefs so the long module list does not feel glued to the card.
 */
export default function AuthLayout({ title, subtitle, children, footer, showcase }) {
  const reduce = useReducedMotion()
  const brand = (
    <div className="mb-4 flex flex-col items-center px-1 text-center sm:mb-6">
      <BrandMark className="mb-2.5 sm:mb-3" size="lg" alt="WEHS" />
      <h1 className="text-[22px] font-bold tracking-[-0.02em] text-ink-900 sm:text-2xl">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-1 max-w-[28ch] text-[13px] leading-snug text-ink-500 sm:max-w-none sm:text-sm sm:leading-normal">
          {subtitle}
        </p>
      )}
    </div>
  )
  const panel = (
    <>
      {brand}
      <div className="card p-5 sm:p-8">{children}</div>
      {footer && (
        <div className="mt-4 px-1 text-center text-[13px] leading-relaxed text-ink-600 sm:mt-5 sm:text-sm">
          {footer}
        </div>
      )}
    </>
  )

  return (
    <div className="aurora min-h-screen px-3.5 pb-10 pt-6 sm:px-4 sm:py-12">
      <motion.div
        className={`mx-auto w-full ${showcase ? 'max-w-6xl' : 'max-w-md'}`}
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
      >
        {showcase ? (
          <div className="grid gap-7 sm:gap-8 lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] lg:items-start">
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
