import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePagination, PAGE_SIZE } from './usePagination'

const list = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }))

describe('usePagination', () => {
  it('defaults to 20 per page', () => {
    expect(PAGE_SIZE).toBe(20)
    const { result } = renderHook(() => usePagination(list(50)))
    expect(result.current.pageItems).toHaveLength(20)
    expect(result.current.pageCount).toBe(3)
    expect(result.current.total).toBe(50)
  })

  it('slices the right window per page', () => {
    const { result } = renderHook(() => usePagination(list(50)))
    expect(result.current.pageItems[0].id).toBe(1)
    act(() => result.current.setPage(2))
    expect(result.current.pageItems[0].id).toBe(21)
    act(() => result.current.setPage(3))
    expect(result.current.pageItems.map((r) => r.id)).toEqual([41, 42, 43, 44, 45, 46, 47, 48, 49, 50])
  })

  it('leaves a short list alone and reports it as single-page', () => {
    const { result } = renderHook(() => usePagination(list(5)))
    expect(result.current.pageItems).toHaveLength(5)
    expect(result.current.single).toBe(true)
    expect(result.current.pageCount).toBe(1)
  })

  // Filtering while deep in a list would otherwise leave you on an empty page,
  // which reads as "the filter matched nothing".
  it('clamps the page when the list shrinks under it', () => {
    let items = list(100)
    const { result, rerender } = renderHook(() => usePagination(items))
    act(() => result.current.setPage(5))
    expect(result.current.page).toBe(5)
    items = list(10)
    rerender()
    expect(result.current.page).toBe(1)
    expect(result.current.pageItems).toHaveLength(10)
  })

  it('recovers the earlier page when the list grows back', () => {
    let items = list(10)
    const { result, rerender } = renderHook(() => usePagination(items))
    act(() => result.current.setPage(3)) // clamped to 1
    expect(result.current.page).toBe(1)
    items = list(100)
    rerender()
    // The requested page is remembered, not overwritten by the clamp.
    expect(result.current.page).toBe(3)
  })

  it('refuses a page below the first', () => {
    const { result } = renderHook(() => usePagination(list(50)))
    act(() => result.current.setPage(0))
    expect(result.current.page).toBe(1)
    act(() => result.current.setPage(-4))
    expect(result.current.page).toBe(1)
  })

  it('handles an empty list without dividing by zero', () => {
    const { result } = renderHook(() => usePagination([]))
    expect(result.current).toMatchObject({ pageCount: 1, total: 0, page: 1, single: true })
    expect(result.current.pageItems).toEqual([])
  })

  it('honours an explicit page size', () => {
    const { result } = renderHook(() => usePagination(list(10), 3))
    expect(result.current.pageItems).toHaveLength(3)
    expect(result.current.pageCount).toBe(4)
  })

  it('divides evenly without an empty trailing page', () => {
    const { result } = renderHook(() => usePagination(list(40)))
    expect(result.current.pageCount).toBe(2)
  })
})
