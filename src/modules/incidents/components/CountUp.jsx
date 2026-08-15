import { useEffect, useRef } from 'react'

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Animated number that counts up to `value` whenever it changes.
 *
 * Replaces the framer-motion version (useMotionValue + useTransform + animate +
 * motion.span) which drove its animation through framer's internal rAF loop.
 * When multiple CountUp instances were on the dashboard together, each one's
 * useTransform callback triggered a forced reflow inside that shared rAF,
 * compounding to 78-163ms per frame — well past Chrome's 50ms violation
 * threshold.
 *
 * This version uses a plain rAF loop with direct DOM writes via a ref. Zero
 * React renders or framer-motion overhead during animation.
 */
export default function CountUp({ value = 0, duration = 1 }) {
  const target = Number(value) || 0
  const spanRef = useRef(null)
  const fromRef = useRef(0)

  useEffect(() => {
    const from = fromRef.current
    const el = spanRef.current
    if (from === target || prefersReduced() || !el) {
      fromRef.current = target
      if (el) el.textContent = target.toLocaleString()
      return undefined
    }
    const ms = duration * 1000
    let raf
    let start
    const easeOut = (t) => 1 - Math.pow(1 - t, 3)
    const step = (ts) => {
      if (start === undefined) start = ts
      const p = Math.min(1, (ts - start) / ms)
      const current = Math.round(from + (target - from) * easeOut(p))
      el.textContent = current.toLocaleString()
      if (p < 1) raf = requestAnimationFrame(step)
      else fromRef.current = target
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  return <span ref={spanRef}>{target.toLocaleString()}</span>
}
