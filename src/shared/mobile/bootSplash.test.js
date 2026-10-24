// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BOOT_FADE_MS, BOOT_HOLD_MS, bootSplashPlan, dismissBootSplash } from './bootSplash'
import { VIEW_MODE_KEY } from './viewMode'

describe('bootSplashPlan', () => {
  it('skips a wide browser and keeps a phone, a native shell, and reduced motion', () => {
    expect(bootSplashPlan({ wide: true, native: false, reduce: false })).toEqual({
      show: false,
      holdMs: 0,
      fadeMs: 0,
    })
    expect(bootSplashPlan({ wide: true, native: true, reduce: false }).show).toBe(true)
    const phone = bootSplashPlan({ wide: false, native: false, reduce: false })
    expect(phone.show).toBe(true)
    expect(phone.holdMs).toBeGreaterThan(0)
    expect(phone.fadeMs).toBeGreaterThan(0)
    const still = bootSplashPlan({ wide: false, native: false, reduce: true })
    expect(still.show).toBe(true)
    expect(still.holdMs).toBeLessThan(phone.holdMs)
    expect(
      bootSplashPlan({ wide: false, native: false, reduce: false, desktopChoice: true }).show
    ).toBe(false)
    expect(
      bootSplashPlan({ wide: false, native: true, reduce: false, desktopChoice: true }).show
    ).toBe(true)
  })
})

describe('dismissBootSplash', () => {
  afterEach(() => {
    document.getElementById('boot-splash')?.remove()
    document.documentElement.classList.remove('native-shell')
    localStorage.removeItem(VIEW_MODE_KEY)
    vi.useRealTimers()
  })

  function mount() {
    const el = document.createElement('div')
    el.id = 'boot-splash'
    document.body.appendChild(el)
    return el
  }

  function media(query) {
    window.matchMedia = (q) => ({
      matches: query(q),
      addEventListener() {},
      removeEventListener() {},
    })
  }

  it('removes the splash immediately on a desktop browser', () => {
    const el = mount()
    media((q) => q.includes('768px'))
    dismissBootSplash()
    expect(el.isConnected).toBe(false)
  })

  it('removes the splash immediately when this device has chosen the desktop portal', () => {
    const el = mount()
    media(() => false)
    localStorage.setItem(VIEW_MODE_KEY, 'desktop')
    dismissBootSplash()
    expect(el.isConnected).toBe(false)
  })

  it('holds, then fades, on a phone', () => {
    vi.useFakeTimers()
    const el = mount()
    media(() => false)
    dismissBootSplash()
    expect(el.isConnected).toBe(true)
    vi.advanceTimersByTime(BOOT_HOLD_MS)
    expect(el.classList.contains('boot-splash-out')).toBe(true)
    vi.advanceTimersByTime(BOOT_FADE_MS)
    expect(el.isConnected).toBe(false)
  })

  it('does not start a second timer when called twice', () => {
    vi.useFakeTimers()
    mount()
    media(() => false)
    dismissBootSplash()
    dismissBootSplash()
    vi.advanceTimersByTime(BOOT_HOLD_MS)
    expect(document.getElementById('boot-splash')?.classList.contains('boot-splash-out')).toBe(true)
  })
})
