// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import StoreBadges from './StoreBadges'

const PLAY = 'https://play.google.com/store/apps/details?id=org.weehs.ohsms'
const APPLE = 'https://apps.apple.com/app/weehs-ohsms/id0000000000'

afterEach(cleanup)

describe('StoreBadges', () => {
  it('shows both official badges as coming soon, and not as links, when no listing is set', () => {
    render(<StoreBadges links={{ play: null, appStore: null }} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByRole('group', { name: 'Get it on Google Play. Coming soon.' })).toBeTruthy()
    expect(
      screen.getByRole('group', { name: 'Download on the App Store. Coming soon.' })
    ).toBeTruthy()
    expect(screen.getAllByText('Coming soon')).toHaveLength(2)
    const images = [...document.querySelectorAll('img')].map((img) => img.getAttribute('src'))
    expect(images).toEqual(['/badges/google-play-badge.png', '/badges/app-store-badge.svg'])
  })

  it('links a badge only when that store has an https listing', () => {
    render(<StoreBadges links={{ play: PLAY, appStore: APPLE }} />)
    const play = screen.getByRole('link', { name: /Get it on Google Play/ })
    const apple = screen.getByRole('link', { name: /Download on the App Store/ })
    expect(play.getAttribute('href')).toBe(PLAY)
    expect(apple.getAttribute('href')).toBe(APPLE)
    expect(play.getAttribute('target')).toBe('_blank')
    expect(play.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.queryByText('Coming soon')).toBeNull()
    expect(screen.queryByRole('link', { name: /evil/ })).toBeNull()
  })

  it('drops a listing that is not the real store and keeps the other', () => {
    render(<StoreBadges links={{ play: 'https://evil.example/app', appStore: APPLE }} />)
    expect(screen.queryByRole('link', { name: /Google Play/ })).toBeNull()
    expect(screen.getByRole('group', { name: /Google Play/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /App Store/ }).getAttribute('href')).toBe(APPLE)
  })

  it('is absent inside the native shell and does not read the public config', () => {
    const load = vi.fn()
    const { container } = render(<StoreBadges native load={load} />)
    expect(container.firstChild).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('fills a blank env from the public config', async () => {
    const load = vi.fn(async () => ({ playStoreUrl: PLAY, appStoreUrl: '' }))
    render(<StoreBadges load={load} />)
    expect((await screen.findByRole('link', { name: /Google Play/ })).getAttribute('href')).toBe(
      PLAY
    )
    expect(screen.getByRole('group', { name: /App Store/ })).toBeTruthy()
    expect(load).toHaveBeenCalled()
  })
})
