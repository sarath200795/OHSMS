import { useEffect, useRef } from 'react'

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Animated number that eases from its previous value to the new one.
//
// The previous version called setState() on every animation frame, which
// triggers React's reconciler on every frame. When several CountUp instances
// are on screen together (as on the HIRA dashboard), the combined reconciliation
// time pushed the rAF handler past Chrome's 50ms violation threshold.
//
// This version writes to the DOM directly via a ref. No React renders happen
// during the animation — only the final value is committed to the ref, so a
// parent re-render always finds the correct text.
export default function CountUp({ value = 0, duration = 700 }) {
  const target = Number(value) || 0
  const spanRef = useRef(null)
  const fromRef = useRef(target)

  useEffect(() => {
    const from = fromRef.current
    const el = spanRef.current
    if (from === target || prefersReduced() || !el) {
      fromRef.current = target
      if (el) el.textContent = target.toLocaleString()
      return undefined
    }
    let raf
    let start
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)
    const step = (ts) => {
      if (start === undefined) start = ts
      const p = Math.min(1, (ts - start) / duration)
      const current = Math.round(from + (target - from) * easeOutCubic(p))
      // Direct DOM write — no React reconciliation overhead per frame.
      el.textContent = current.toLocaleString()
      if (p < 1) raf = requestAnimationFrame(step)
      else fromRef.current = target
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  return <span ref={spanRef}>{target.toLocaleString()}</span>
}
