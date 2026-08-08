import { useMemo, useState } from 'react'

/**
 * Page size for every list in the app.
 *
 * Long tables are slow for a reason that is easy to miss: it is not the data,
 * which is already in memory, it is the DOM. A thousand-row inventory is
 * thousands of nodes to lay out and paint on every filter keystroke, and on the
 * phones these are read on in a plant room that is seconds of unresponsiveness.
 * Twenty renders instantly and is about as much as anyone scans at once.
 */
export const PAGE_SIZE = 20

/**
 * Slice a list into pages.
 *
 * The page is CLAMPED rather than stored blindly: filtering while on page 7 of
 * 9 would otherwise leave you looking at an empty page 7 of 2, which reads as
 * "the filter matched nothing". Clamping means the view falls back to the last
 * real page on its own, with no effect to keep in sync.
 *
 * @param items    the full, already-filtered list
 * @param pageSize override only where a page genuinely needs a different size
 */
export function usePagination(items = [], pageSize = PAGE_SIZE) {
  const [page, setPage] = useState(1)

  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), pageCount)

  const pageItems = useMemo(
    () => (total <= pageSize ? items : items.slice((safePage - 1) * pageSize, safePage * pageSize)),
    [items, safePage, pageSize, total]
  )

  return {
    /** Rows to render. */
    pageItems,
    /** The page actually being shown, after clamping. */
    page: safePage,
    setPage,
    pageCount,
    total,
    pageSize,
    /** True when the list fits on one page — callers can skip the controls. */
    single: pageCount <= 1,
  }
}
