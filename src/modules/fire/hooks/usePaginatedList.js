import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Generic cursor-pagination hook.
 *
 * @param fetchPage  async ({ cursor }) => { rows, nextCursor, hasMore }
 * @param deps       when these change, the list resets and refetches page 1
 *
 * Returns { rows, loading, loadingMore, hasMore, error, loadMore, reset }.
 */
export function usePaginatedList(fetchPage, deps = []) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState(null)
  const cursorRef = useRef(null)
  // Guard against out-of-order responses when deps change mid-fetch.
  const runRef = useRef(0)

  const loadFirst = useCallback(async () => {
    const run = ++runRef.current
    setLoading(true)
    setError(null)
    cursorRef.current = null
    try {
      const { rows: r, nextCursor, hasMore: more } = await fetchPage({ cursor: null })
      if (run !== runRef.current) return // a newer reset superseded us
      setRows(r)
      cursorRef.current = nextCursor
      setHasMore(more)
    } catch (e) {
      if (run === runRef.current) setError(e)
    } finally {
      if (run === runRef.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    const run = runRef.current
    setLoadingMore(true)
    try {
      const { rows: r, nextCursor, hasMore: more } = await fetchPage({ cursor: cursorRef.current })
      if (run !== runRef.current) return
      setRows((prev) => [...prev, ...r])
      cursorRef.current = nextCursor
      setHasMore(more)
    } catch (e) {
      if (run === runRef.current) setError(e)
    } finally {
      if (run === runRef.current) setLoadingMore(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loadingMore, ...deps])

  useEffect(() => {
    loadFirst()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  // Optimistic local mutation (e.g. remove a row after delete) without a refetch.
  const patchRows = useCallback((updater) => setRows((prev) => updater(prev)), [])

  return { rows, loading, loadingMore, hasMore, error, loadMore, reset: loadFirst, patchRows }
}
