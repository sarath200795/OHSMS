import { useEffect, useRef, useState } from 'react'

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Animated number that eases from its previous value to the new one.
export default function CountUp({ value = 0, duration = 700 }) {
  const target = Number(value) || 0
  const [display, setDisplay] = useState(target)
  const fromRef = useRef(target)

  useEffect(() => {
    const from = fromRef.current
    if (from === target || prefersReduced()) {
      fromRef.current = target
      setDisplay(target)
      return undefined
    }
    let raf
    let start
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)
    const step = (ts) => {
      if (start === undefined) start = ts
      const p = Math.min(1, (ts - start) / duration)
      setDisplay(Math.round(from + (target - from) * easeOutCubic(p)))
      if (p < 1) raf = requestAnimationFrame(step)
      else fromRef.current = target
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  return <>{display.toLocaleString()}</>
}
