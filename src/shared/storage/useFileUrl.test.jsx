// @vitest-environment jsdom
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fileUrl = vi.hoisted(() => vi.fn())

vi.mock('./index', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, fileUrl }
})

const { useFileUrl } = await import('./useFileUrl')

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

  it('falls back to the stored thumb after path fetches keep coming back empty', async () => {
    fileUrl.mockResolvedValue({ url: '', revoke: () => {} })
    const { result } = renderHook(() =>
      useFileUrl({ url: 'data:image/jpeg;base64,thumb', path: 'orgs/a/org-logo/x.png' })
    )

    await waitFor(
      () => {
        expect(result.current.loading).toBe(false)
        expect(result.current.src).toBe('data:image/jpeg;base64,thumb')
      },
      { timeout: 4000 }
    )
    expect(fileUrl.mock.calls.length).toBeGreaterThanOrEqual(3)
  }, 8000)
})
