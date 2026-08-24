import { useEffect, useRef } from 'react'
import { ResponsiveContainer } from 'recharts'
import { useDeferredMount } from '../lib/useDeferredMount'

/**
 * recharts' ResponsiveContainer, mounted one paint later.
 *
 * ResponsiveContainer measures its box with getBoundingClientRect inside its
 * mount effect — a synchronous layout read in the same commit that just built
 * the screen, so the browser has to resolve the layout of the whole page on the
 * spot to answer it. A dashboard mounts a dozen charts in that one commit;
 * measured on the portal home screen the first of them cost 60-70ms, which is
 * what Chrome reports as "Forced reflow while executing JavaScript took Nms".
 *
 * See useDeferredMount for why waiting for the paint makes that free. The
 * placeholder holds the chart's height meanwhile, so the card does not resize
 * when the chart arrives, and the rest of it — heading, numbers, empty-state
 * copy — paints a frame sooner.
 *
 * Drop-in for ResponsiveContainer: same props, same children.
 *
 * ── Accessibility ───────────────────────────────────────────────────────────
 * recharts renders each slice and bar as a <path role="img"> with no name, so a
 * screen reader met a pie chart as "image, image, image" — three unnamed
 * graphics carrying the org's incident split. axe reports it as svg-img-alt and
 * it is a fair report: that is not information, it is noise where information
 * should be.
 *
 * `label` is how a chart says what it shows, and it is REQUIRED — the same
 * contract as IconButton, for the same reason: an optional correctness step
 * that every call site has to remember is one most of them will not.
 *
 * The frame becomes a single graphic with that name, and role="img" makes
 * everything inside it presentational, so the chart is announced once instead of
 * as a run of unnamed paths. Hiding the chart instead was tried and is worse:
 * recharts puts focusable nodes inside, and aria-hidden over a focusable
 * subtree is its own violation — a control a keyboard can reach and a screen
 * reader cannot see.
 *
 * Write the label as the sentence the chart is making, not as its title:
 * "Extinguishers by type: 12 CO2, 8 DCP, 3 Foam" tells someone what the picture
 * says, where "Pie chart" tells them only that they are missing something.
 */
export default function ChartFrame({ children, height, label, ...rest }) {
  const ready = useDeferredMount()
  const ref = useRef(null)

  if (import.meta.env.DEV && !label) {
    throw new Error('ChartFrame requires a `label` — it is the chart\'s only accessible name.')
  }

  // recharts stamps role="img" on every slice and bar it draws, so a five-slice
  // pie arrives as five unnamed graphics no matter what the wrapper says — and
  // it puts a tabbable <g> in there too, so simply hiding the subtree would
  // create a control a keyboard can reach and a screen reader cannot see.
  //
  // Both are stripped here, after render, because neither is reachable through
  // a recharts prop. The wrapper's own role="img" + aria-label is then the one
  // thing announced, which is what a chart should be: a picture with a caption.
  useEffect(() => {
    const root = ref.current
    if (!root) return undefined
    const strip = () => {
      for (const el of root.querySelectorAll('[role="img"]')) {
        if (el !== root) el.setAttribute('role', 'presentation')
      }
      for (const el of root.querySelectorAll('[tabindex]')) {
        if (el.getAttribute('tabindex') !== '-1') el.setAttribute('tabindex', '-1')
      }
    }
    strip()
    // recharts re-renders its SVG on resize and on data changes, restoring both.
    const mo = new MutationObserver(strip)
    mo.observe(root, { childList: true, subtree: true, attributeFilter: ['role', 'tabindex'] })
    return () => mo.disconnect()
  }, [ready, children])

  if (!ready) return <div aria-hidden="true" style={{ width: '100%', height }} />

  return (
    <div ref={ref} role="img" aria-label={label} style={{ width: '100%', height }}>
      <ResponsiveContainer height={height} {...rest}>
        {children}
      </ResponsiveContainer>
    </div>
  )
}
