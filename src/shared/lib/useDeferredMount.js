import { useEffect, useState } from 'react'

/**
 * `false` until the browser has painted, then `true` — for content that measures
 * the page when it mounts.
 *
 * Reading layout (getBoundingClientRect, scrollTop, offsetHeight…) inside a
 * mount effect forces the browser to resolve the layout of everything that was
 * just rendered, synchronously, before the JS can continue. On a screen the size
 * of a dashboard that costs tens of milliseconds and Chrome logs it as "Forced
 * reflow while executing JavaScript took Nms". Two things in this app do it:
 * recharts' ResponsiveContainer measures its box, and framer-motion's `drag`
 * measures scroll offsets when it attaches its listeners.
 *
 * Gate them on this and the same measurement runs a task later against a layout
 * the browser has already settled, so it costs nothing.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.idle]    wait for the page to fall idle first, not just
 *                                 for the next paint — for decoration that
 *                                 should never compete with real content.
 * @param {number}  [opts.timeout] how long to wait for that idle moment before
 *                                 mounting anyway.
 */
export function useDeferredMount({ idle = false, timeout = 2000 } = {}) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let frame = 0
    let timer
    let fallback

    // requestAnimationFrame alone is not enough: its callback runs *before* the
    // frame's layout, so mounting there lands in exactly the dirty layout this
    // is avoiding. The timeout inside it runs on the next task, after the paint.
    //
    // A tab that is not visible never runs animation frames at all — a page
    // opened in a background tab would otherwise sit on its placeholders until
    // someone looked at it. There is no paint to wait for there and no jank to
    // avoid, so a plain timer takes over.
    const afterPaint = () => {
      frame = requestAnimationFrame(() => {
        clearTimeout(fallback)
        timer = setTimeout(() => setReady(true), 0)
      })
      fallback = setTimeout(() => {
        cancelAnimationFrame(frame)
        setReady(true)
      }, 200)
    }

    const stop = () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      clearTimeout(fallback)
    }

    if (!idle) {
      afterPaint()
      return stop
    }

    // requestIdleCallback is unavailable on older Safari; a short wait is the
    // same idea with worse timing, which is acceptable for decoration.
    const request = window.requestIdleCallback
    if (!request) {
      const wait = setTimeout(afterPaint, 200)
      return () => {
        clearTimeout(wait)
        stop()
      }
    }
    const handle = request(afterPaint, { timeout })
    return () => {
      window.cancelIdleCallback(handle)
      stop()
    }
  }, [idle, timeout])

  return ready
}
