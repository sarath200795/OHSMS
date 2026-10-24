// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import StoreBadges from './StoreBadges'

const PLAY = 'https://play.google.com/store/apps/details?id=org.weehs.ohsms'
const APPLE = 'https://apps.apple.com/app/weehs-ohsms/id0000000000'
const FLIGHT = 'https://testflight.apple.com/join/abc'
const release = { version: '1.0', url: '/downloads/weehs-ohsms.apk' }

afterEach(cleanup)

describe('StoreBadges', () => {
  it('offers the APK and the iPhone steps, and no store badge, when no listing is set', () => {
    render(<StoreBadges links={{ play: null, appStore: null }} release={release} />)
    expect(screen.queryByText('Coming soon')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
    const apk = screen.getByRole('link', { name: 'Download APK' })
    expect(apk.getAttribute('href')).toBe('/downloads/weehs-ohsms.apk')
    expect(screen.getByText(/Version 1\.0/)).toBeTruthy()
    expect(screen.getByText(/install unknown apps/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Install on iPhone' })).toBeTruthy()
  })

  it('explains Home Screen install and does not offer an app file for iPhone', () => {
    render(<StoreBadges links={{ play: null, appStore: null }} release={release} />)
    fireEvent.click(screen.getByRole('button', { name: 'Install on iPhone' }))
    const dialog = screen.getByRole('dialog', { name: 'Install on iPhone' })
    expect(dialog).toBeTruthy()
    expect(screen.getByText(/Add to Home Screen/)).toBeTruthy()
    expect(screen.queryByText(/\.ipa/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('links a store badge only when that store has an https listing', () => {
    render(<StoreBadges links={{ play: PLAY, appStore: APPLE }} release={release} />)
    const play = screen.getByRole('link', { name: /Get it on Google Play/ })
    const apple = screen.getByRole('link', { name: /Download on the App Store/ })
    expect(play.getAttribute('href')).toBe(PLAY)
    expect(apple.getAttribute('href')).toBe(APPLE)
    expect(play.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByRole('link', { name: 'Download APK' })).toBeTruthy()
  })

  it('drops a listing that is not the real store and keeps the download', () => {
    render(
      <StoreBadges
        links={{ play: 'https://evil.example/app', appStore: APPLE }}
        release={release}
      />
    )
    expect(screen.queryByRole('link', { name: /Google Play/ })).toBeNull()
    expect(screen.getByRole('link', { name: /App Store/ }).getAttribute('href')).toBe(APPLE)
    expect(screen.getByRole('link', { name: 'Download APK' }).getAttribute('href')).toBe(
      '/downloads/weehs-ohsms.apk'
    )
  })

  it('shows a TestFlight link only for testflight.apple.com', () => {
    render(
      <StoreBadges links={{ play: null, appStore: null, testFlight: FLIGHT }} release={release} />
    )
    expect(screen.getByRole('link', { name: /Join the TestFlight/ }).getAttribute('href')).toBe(
      FLIGHT
    )
    cleanup()
    render(
      <StoreBadges
        links={{ play: null, appStore: null, testFlight: 'https://evil.example/join' }}
        release={release}
      />
    )
    expect(screen.queryByRole('link', { name: /TestFlight/ })).toBeNull()
  })

  it('is absent inside the native shell and does not read the public config', () => {
    const load = vi.fn()
    const loadRelease = vi.fn()
    const { container } = render(<StoreBadges native load={load} loadRelease={loadRelease} />)
    expect(container.firstChild).toBeNull()
    expect(load).not.toHaveBeenCalled()
    expect(loadRelease).not.toHaveBeenCalled()
  })

  it('fills a blank env from the public config', async () => {
    const load = vi.fn(async () => ({ playStoreUrl: PLAY, appStoreUrl: '', testFlightUrl: '' }))
    render(<StoreBadges load={load} release={release} />)
    expect((await screen.findByRole('link', { name: /Google Play/ })).getAttribute('href')).toBe(
      PLAY
    )
    expect(screen.queryByRole('link', { name: /App Store/ })).toBeNull()
    expect(load).toHaveBeenCalled()
  })
})
