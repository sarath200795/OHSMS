import { useEffect } from 'react'
import { useMotionValue, useTransform, animate, motion } from 'framer-motion'

/** Animated number that counts up to `value` whenever it changes. */
export default function CountUp({ value = 0, duration = 1 }) {
  const count = useMotionValue(0)
  const rounded = useTransform(count, (v) => Math.round(v).toLocaleString())

  useEffect(() => {
    const controls = animate(count, value, { duration, ease: 'easeOut' })
    return controls.stop
  }, [value, duration, count])

  return <motion.span>{rounded}</motion.span>
}
