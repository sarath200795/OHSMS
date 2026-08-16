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
 */
export default function ChartFrame({ children, height, ...rest }) {
  const ready = useDeferredMount()

  if (!ready) return <div aria-hidden="true" style={{ width: '100%', height }} />

  return (
    <ResponsiveContainer height={height} {...rest}>
      {children}
    </ResponsiveContainer>
  )
}
