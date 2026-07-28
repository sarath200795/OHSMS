import { AnimatePresence, motion } from 'framer-motion'

export default function Modal({ open, onClose, title, subtitle, children, maxW = 'max-w-md' }) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            className="absolute inset-0 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            onClick={onClose}
          />
          {/* Modals stay centered (not trigger-anchored); enter ease-out, exit faster. */}
          <motion.div
            className={`relative w-full ${maxW} clay-card max-h-[85vh] overflow-y-auto p-6`}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
          >
            {title && <h3 className="text-lg font-bold text-steel-50">{title}</h3>}
            {subtitle && <p className="mt-1 text-sm text-steel-400">{subtitle}</p>}
            <div className="mt-4">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
