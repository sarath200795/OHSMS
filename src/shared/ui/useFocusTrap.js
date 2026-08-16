// ─────────────────────────────────────────────────────────────────────────────
// Focus containment for modal dialogs.
//
// Without this, Tab walks straight out of an open dialog and into the page
// behind it: a keyboard or screen-reader user ends up operating controls they
// cannot see, still covered by the backdrop. WAI-ARIA's dialog pattern asks for
// three things and this hook does all three — move focus in on open, keep Tab
// inside while open, and put focus back where it came from on close.
//
// The keydown listener is attached to the dialog element (not the document) so
// nested dialogs work: the innermost one is the deepest node the event passes
// through, and its stopPropagation keeps the outer trap from also reacting.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef } from 'react'

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Tabbable descendants of `root`, in document order, skipping hidden ones. */
export function focusableWithin(root) {
  if (!root) return []
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && (el.offsetParent !== null || el.getClientRects().length > 0)
  )
}

/**
 * @param {boolean} open   whether the dialog is mounted and visible
 * @param {() => void} onClose  called on Escape
 * @returns {{ ref: React.RefObject, onKeyDown: (e: KeyboardEvent) => void }}
 *   Spread onto the dialog element: `<div ref={ref} onKeyDown={onKeyDown} tabIndex={-1}>`
 */
export function useFocusTrap(open, onClose) {
  const ref = useRef(null)

  // Held in a ref so an inline `onClose={() => …}` arrow — which changes
  // identity every render — cannot re-run the effect below and yank focus back
  // to the first field while the user is part-way through the form.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    if (!open) return undefined
    const root = ref.current
    const restoreTo = document.activeElement

    // Focus the first control, or the dialog itself when it has none, so the
    // screen reader announces the dialog rather than continuing to read the page.
    const first = focusableWithin(root)[0]
    ;(first || root)?.focus?.({ preventScroll: true })

    // The page behind a dialog must not scroll under it.
    const body = document.body
    const prevOverflow = body.style.overflow
    body.style.overflow = 'hidden'

    return () => {
      body.style.overflow = prevOverflow
      // Hand focus back to whatever opened the dialog. If that element has since
      // unmounted, focus() is simply unavailable and focus falls to <body>.
      if (restoreTo && document.contains(restoreTo)) restoreTo.focus?.({ preventScroll: true })
    }
  }, [open])

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      closeRef.current?.()
      return
    }
    if (e.key !== 'Tab') return

    const root = ref.current
    const items = focusableWithin(root)
    if (!items.length) {
      // Nothing to tab to — hold focus on the dialog rather than let it escape.
      e.preventDefault()
      root?.focus?.({ preventScroll: true })
      return
    }

    const firstEl = items[0]
    const lastEl = items[items.length - 1]
    const active = document.activeElement
    const inside = root?.contains(active)

    if (e.shiftKey) {
      if (active === firstEl || !inside) {
        e.preventDefault()
        lastEl.focus()
      }
    } else if (active === lastEl || !inside) {
      e.preventDefault()
      firstEl.focus()
    }
  }, [])

  return { ref, onKeyDown }
}
