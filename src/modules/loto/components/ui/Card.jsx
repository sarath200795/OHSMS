import { motion } from 'framer-motion'
import { Card as SharedCard } from '../../../../shared/ui'

// The surface is the shared card. `animate` is the loto-specific part: most of
// this module's cards opt out, but the ones that don't rise into place on mount.
const ENTER = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3, ease: [0.23, 1, 0.32, 1] },
}

export default function Card({ children, className = '', animate = true, ...props }) {
  if (!animate) {
    return (
      <SharedCard className={className} {...props}>
        {children}
      </SharedCard>
    )
  }
  return (
    <SharedCard as={motion.div} className={className} {...ENTER} {...props}>
      {children}
    </SharedCard>
  )
}
