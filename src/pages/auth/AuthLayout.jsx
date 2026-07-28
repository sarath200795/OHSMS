import { motion, useReducedMotion } from 'framer-motion'

export default function AuthLayout({ title, subtitle, children, footer }) {
  const reduce = useReducedMotion()
  return (
    <div className="aurora grid min-h-screen place-items-center p-4">
      <motion.div
        className="w-full max-w-md"
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/wehs.svg" alt="WEHS" className="mb-3 h-16 w-16 rounded-2xl drop-shadow-lg" />
          <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-white/70">{subtitle}</p>}
        </div>
        <div className="card p-6 sm:p-8">{children}</div>
        {footer && <div className="mt-5 text-center text-sm text-white/80">{footer}</div>}
      </motion.div>
    </div>
  )
}
