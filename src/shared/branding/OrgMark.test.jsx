// @vitest-environment jsdom
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const useAuth = vi.hoisted(() => vi.fn())
const useFileUrl = vi.hoisted(() => vi.fn())

vi.mock('../auth/AuthContext', () => ({ useAuth }))
vi.mock('../storage/useFileUrl', () => ({
  useFileUrl,
  inlineImageSrc: (url) => {
    const s = typeof url === 'string' ? url.trim() : ''
    return s.startsWith('data:image/') || s.startsWith('blob:') ? s : ''
  },
}))

const { OrgMark, hasOrgLogo, WE_EHS_MARK } = await import('./OrgMark')

afterEach(cleanup)

beforeEach(() => {
  useAuth.mockReset()
  useFileUrl.mockReset()
  useFileUrl.mockReturnValue({ src: '', loading: false })
})

describe('hasOrgLogo', () => {
  it('is true for a path-only logo (the shape uploads write after M-5)', () => {
    expect(hasOrgLogo({ logoPath: 'orgs/a/org-logo/x.png', logoUrl: '' })).toBe(true)
  })

  it('is true for a legacy download URL with no path', () => {
    expect(hasOrgLogo({ logoUrl: 'https://legacy.test/logo.png' })).toBe(true)
  })

  it('is false when neither field is set', () => {
    expect(hasOrgLogo({})).toBe(false)
    expect(hasOrgLogo({ logoUrl: '', logoPath: '' })).toBe(false)
    expect(hasOrgLogo(null)).toBe(false)
  })
})

describe('OrgMark', () => {
  it('falls back to the WE EHS mark when the org has no logo', () => {
    useAuth.mockReturnValue({ org: {} })
    render(<OrgMark alt="mark" />)
    expect(screen.getByAltText('mark').getAttribute('src')).toBe(WE_EHS_MARK)
  })

  it('renders the resolved blob for a logo that only has a path', () => {
    useAuth.mockReturnValue({ org: { logoPath: 'orgs/a/org-logo/x.png', logoUrl: '' } })
    useFileUrl.mockReturnValue({ src: 'blob:logo', loading: false })
    render(<OrgMark alt="org" />)
    expect(useFileUrl).toHaveBeenCalledWith({ url: '', path: 'orgs/a/org-logo/x.png' })
    expect(screen.getByAltText('org').getAttribute('src')).toBe('blob:logo')
  })

  it('does not flash the vendor mark while a stored logo is still resolving', () => {
    useAuth.mockReturnValue({ org: { logoPath: 'orgs/a/org-logo/x.png' } })
    useFileUrl.mockReturnValue({ src: '', loading: true })
    const { container } = render(<OrgMark alt="org" />)
    expect(screen.queryByAltText('org')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('keeps a cream slot when a configured logo fails to resolve, rather than the vendor mark', () => {
    useAuth.mockReturnValue({ org: { logoPath: 'orgs/a/org-logo/x.png', logoUrl: '' } })
    useFileUrl.mockReturnValue({ src: '', loading: false })
    const { container } = render(<OrgMark alt="org" />)
    expect(screen.queryByAltText('org')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('span.bg-ink-50')).toBeTruthy()
  })

  it('paints the inline thumb while the path fetch has not produced a src', () => {
    useAuth.mockReturnValue({
      org: { logoPath: 'orgs/a/org-logo/x.png', logoUrl: 'data:image/jpeg;base64,thumb' },
    })
    useFileUrl.mockReturnValue({ src: '', loading: true })
    render(<OrgMark alt="org" />)
    expect(screen.getByAltText('org').getAttribute('src')).toBe('data:image/jpeg;base64,thumb')
  })

  it('prefers the inline thumb over a download URL the browser may not paint', () => {
    useAuth.mockReturnValue({
      org: { logoPath: 'orgs/a/org-logo/x.png', logoUrl: 'data:image/jpeg;base64,thumb' },
    })
    useFileUrl.mockReturnValue({
      src: 'https://firebasestorage.googleapis.com/o/logo.jpg?alt=media&token=t',
      loading: false,
    })
    render(<OrgMark alt="org" />)
    expect(screen.getByAltText('org').getAttribute('src')).toBe('data:image/jpeg;base64,thumb')
  })

  it('drops a download URL that errors and keeps the cream slot when there is no thumb', () => {
    useAuth.mockReturnValue({ org: { logoPath: 'orgs/a/org-logo/x.png', logoUrl: '' } })
    useFileUrl.mockReturnValue({ src: 'https://cdn.example/logo.jpg', loading: false })
    const { container } = render(<OrgMark alt="org" />)
    fireEvent.error(screen.getByAltText('org'))
    expect(screen.queryByAltText('org')).toBeNull()
    expect(container.querySelector('span.bg-ink-50')).toBeTruthy()
  })
})
