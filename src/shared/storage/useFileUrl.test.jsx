// @vitest-environment jsdom
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fileUrl = vi.hoisted(() => vi.fn())

vi.mock('./index', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, fileUrl }
})

const { useFileUrl, displayFileSrc } = await import('./useFileUrl')

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  fileUrl.mockReset()
})

describe('useFileUrl', () => {
  it('starts loading when a path must be fetched', () => {
    fileUrl.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useFileUrl({ url: '', path: 'orgs/a/org-logo/x.png' }))
    expect(result.current.loading).toBe(true)
    expect(result.current.src).toBe('')
  })

  it('serves a stored data URL immediately when there is no path', async () => {
    const { result } = renderHook(() => useFileUrl({ url: 'data:image/png;base64,aaa', path: '' }))
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
      expect(result.current.src).toBe('data:image/png;base64,aaa')
    })
    expect(fileUrl).not.toHaveBeenCalled()
  })

  it('shows an inline thumb immediately and keeps it when the path fetch stays empty', async () => {
    fileUrl.mockResolvedValue({ url: '', revoke: () => {} })
    const { result } = renderHook(() =>
      useFileUrl({ url: 'data:image/jpeg;base64,thumb', path: 'orgs/a/org-logo/x.png' })
    )

    expect(result.current.loading).toBe(false)
    expect(result.current.src).toBe('data:image/jpeg;base64,thumb')

    await waitFor(
      () => {
        expect(fileUrl.mock.calls.length).toBeGreaterThanOrEqual(3)
      },
      { timeout: 4000 }
    )
    expect(result.current.src).toBe('data:image/jpeg;base64,thumb')
  }, 8000)

  it('does not replace an inline thumb with an https download URL', async () => {
    fileUrl.mockResolvedValue({
      url: 'https://firebasestorage.googleapis.com/o/logo.jpg?alt=media&token=t',
      revoke: () => {},
    })
    const { result } = renderHook(() =>
      useFileUrl({ url: 'data:image/jpeg;base64,thumb', path: 'orgs/a/org-logo/x.png' })
    )

    await waitFor(() => {
      expect(fileUrl).toHaveBeenCalled()
    })
    expect(result.current.src).toBe('data:image/jpeg;base64,thumb')
  })

  it('upgrades an inline thumb when the path resolves to a blob', async () => {
    fileUrl.mockResolvedValue({ url: 'blob:https://suite.example/logo', revoke: () => {} })
    const { result } = renderHook(() =>
      useFileUrl({ url: 'data:image/jpeg;base64,thumb', path: 'orgs/a/org-logo/x.png' })
    )

    await waitFor(() => {
      expect(result.current.src).toBe('blob:https://suite.example/logo')
    })
  })
})

describe('displayFileSrc', () => {
  it('keeps a data thumb ahead of an https download URL', () => {
    expect(displayFileSrc('https://cdn.example/logo.jpg', 'data:image/jpeg;base64,thumb')).toBe(
      'data:image/jpeg;base64,thumb'
    )
    expect(displayFileSrc('blob:logo', 'data:image/jpeg;base64,thumb')).toBe('blob:logo')
    expect(displayFileSrc('', 'data:image/jpeg;base64,thumb')).toBe('data:image/jpeg;base64,thumb')
    expect(displayFileSrc('https://cdn.example/logo.jpg', '')).toBe('https://cdn.example/logo.jpg')
  })
})
