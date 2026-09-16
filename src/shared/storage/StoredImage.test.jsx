// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// ─────────────────────────────────────────────────────────────────────────────
// The renderers that had to change when uploads stopped minting a download URL
// (audit finding M-5). Each of these used to read `record.url` straight into an
// <img src>, and that field is now empty for anything uploaded after the change
// — so the question these tests answer is whether the picture still appears,
// and whether an OLD record still appears too.
//
// fileUrl is mocked: what is under test is the component's contract with it,
// not Firebase. The revoke half matters as much as the url — an object URL
// pins its bytes until released, and a gallery that forgets leaks every image
// the user scrolls past.
// ─────────────────────────────────────────────────────────────────────────────
const fileUrl = vi.hoisted(() => vi.fn())
vi.mock('./index', () => ({ fileUrl }))

const { StoredImage } = await import('./StoredImage')

beforeEach(() => { fileUrl.mockReset() })

describe('resolving a pointer', () => {
  it('renders the authenticated blob url for a record that has a path', async () => {
    fileUrl.mockResolvedValue({ url: 'blob:resolved', revoke: () => {} })
    render(<StoredImage pointer={{ url: '', path: 'orgs/o1/loto-photos/ab-x.jpg' }} alt="point" />)
    await waitFor(() => expect(screen.getByAltText('point').getAttribute('src')).toBe('blob:resolved'))
    expect(fileUrl).toHaveBeenCalled()
  })

  // The whole reason the stored field is kept rather than dropped: records
  // written before uploads recorded a path have a url and nothing else.
  it('falls back to the stored url when there is no path at all', async () => {
    render(<StoredImage pointer={{ url: 'https://legacy.test/photo.jpg' }} alt="legacy" />)
    await waitFor(() => expect(screen.getByAltText('legacy').getAttribute('src')).toBe('https://legacy.test/photo.jpg'))
    // No path means nothing to fetch — it must not go to the network to
    // rediscover a url it was handed.
    expect(fileUrl).not.toHaveBeenCalled()
  })

  it('renders the fallback when there is neither', () => {
    render(<StoredImage pointer={{}} fallback={<span>No photo</span>} />)
    expect(screen.getByText('No photo')).toBeTruthy()
  })
})

describe('what a reader without the key is told', () => {
  // Distinct from empty, deliberately. A sealed file this manager holds no key
  // for is not a missing file, and showing a blank frame for both is how an
  // unreadable medical record and a deleted one came to look identical.
  it('says restricted rather than showing nothing', async () => {
    fileUrl.mockResolvedValue({ url: null, revoke: () => {}, restricted: true })
    render(<StoredImage pointer={{ path: 'orgs/o1/medical-records/x.pdf' }} fallback={<span>No file</span>} />)
    await waitFor(() => expect(screen.getByText('Restricted')).toBeTruthy())
    expect(screen.queryByText('No file')).toBeNull()
  })
})

describe('object URLs are released', () => {
  it('revokes when the component goes away', async () => {
    const revoke = vi.fn()
    fileUrl.mockResolvedValue({ url: 'blob:one', revoke })
    const { unmount } = render(<StoredImage pointer={{ path: 'p/one.jpg' }} alt="a" />)
    await waitFor(() => expect(screen.getByAltText('a').getAttribute('src')).toBe('blob:one'))
    unmount()
    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it('revokes the superseded url when the pointer changes', async () => {
    const revokeOne = vi.fn()
    fileUrl.mockResolvedValue({ url: 'blob:one', revoke: revokeOne })
    const { rerender } = render(<StoredImage pointer={{ path: 'p/one.jpg' }} alt="a" />)
    await waitFor(() => expect(screen.getByAltText('a').getAttribute('src')).toBe('blob:one'))

    fileUrl.mockResolvedValue({ url: 'blob:two', revoke: vi.fn() })
    rerender(<StoredImage pointer={{ path: 'p/two.jpg' }} alt="a" />)
    await waitFor(() => expect(screen.getByAltText('a').getAttribute('src')).toBe('blob:two'))
    expect(revokeOne).toHaveBeenCalled()
  })

  // A fetch that lands after the component is gone still created an object URL,
  // and nothing is left holding a reference to release it.
  it('releases a url that arrives after unmount', async () => {
    const revoke = vi.fn()
    let settle
    fileUrl.mockReturnValue(new Promise((r) => { settle = r }))
    const { unmount } = render(<StoredImage pointer={{ path: 'p/slow.jpg' }} alt="a" />)
    unmount()
    settle({ url: 'blob:late', revoke })
    await waitFor(() => expect(revoke).toHaveBeenCalled())
  })
})
