// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const html5 = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(async () => {}),
  clear: vi.fn(),
  cameras: vi.fn(async () => []),
}))

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    start(...args) {
      return html5.start(...args)
    }
    stop() {
      return html5.stop()
    }
    clear() {
      return html5.clear()
    }
    static getCameras() {
      return html5.cameras()
    }
  },
}))

const { cameraErrorMessage, cameraUnavailableReason, startBarcodeDetector, startHtml5Scanner } =
  await import('./webScan')

beforeEach(() => {
  html5.start.mockReset()
  html5.stop.mockReset()
  html5.stop.mockResolvedValue(undefined)
  html5.clear.mockReset()
  html5.cameras.mockReset()
  html5.cameras.mockResolvedValue([])
  delete window.BarcodeDetector
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    cb()
    return 1
  })
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  HTMLMediaElement.prototype.play = () => Promise.resolve()
})

afterEach(() => {
  document.body.innerHTML = ''
  delete window.BarcodeDetector
})

function box(id, width, height) {
  const el = document.createElement('div')
  el.id = id
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: height })
  document.body.appendChild(el)
  return el
}

function videoEl() {
  const video = document.createElement('video')
  document.body.appendChild(video)
  return video
}

describe('camera messages', () => {
  it('names permission, a missing camera, a busy camera, and an insecure page', () => {
    expect(cameraErrorMessage(new DOMException('no', 'NotAllowedError'))).toMatch(
      /permission was denied/
    )
    expect(cameraErrorMessage(new DOMException('no', 'NotFoundError'))).toMatch(
      /No camera was found/
    )
    expect(cameraErrorMessage(new DOMException('no', 'NotReadableError'))).toMatch(
      /in use by another app/
    )
    expect(cameraErrorMessage(new DOMException('no', 'SecurityError'))).toMatch(/https/)
    expect(
      cameraErrorMessage('Error getting userMedia, error = NotAllowedError: Permission denied')
    ).toMatch(/permission was denied/)
    expect(
      cameraErrorMessage(
        'Camera access is only supported in secure context like https or localhost.'
      )
    ).toMatch(/https/)
    expect(cameraErrorMessage(new DOMException('closed', 'AbortError'))).toBe('')
    expect(cameraErrorMessage(new Error('denied'), { fallback: 'type the tag' })).toBe(
      'type the tag'
    )
    expect(
      cameraErrorMessage(
        new Error('The camera preview has no size yet. Try again, or paste the code.')
      )
    ).toMatch(/no size/)
  })

  it('refuses an insecure page and a browser with no camera API', () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    expect(cameraUnavailableReason()).toMatch(/https/)
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    const media = navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    expect(cameraUnavailableReason()).toMatch(/cannot scan from the camera/)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: media })
  })
})

describe('startBarcodeDetector', () => {
  it('asks for the back camera, plays inline, and stops the stream if the page closes first', async () => {
    const stop = vi.fn()
    const constraints = []
    let open
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(
          (c) =>
            new Promise((resolve) => {
              constraints.push(c)
              open = () => resolve({ getTracks: () => [{ stop }] })
            })
        ),
      },
    })
    window.BarcodeDetector = class {
      async detect() {
        return []
      }
    }
    const video = videoEl()
    const ac = new AbortController()
    const pending = startBarcodeDetector(video, () => {}, { signal: ac.signal })
    await vi.waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled())
    ac.abort()
    open()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(stop).toHaveBeenCalled()
    expect(constraints[0].video.facingMode.ideal).toBe('environment')
    expect(constraints[0].audio).toBe(false)
    expect(video.getAttribute('playsinline')).toBe('true')
    expect(video.muted).toBe(true)
  })

  it('does not ask again after permission is denied, and falls back when the back camera is refused', async () => {
    const getUserMedia = vi.fn(async () => {
      throw new DOMException('no', 'NotAllowedError')
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    window.BarcodeDetector = class {}
    await expect(startBarcodeDetector(videoEl(), () => {})).rejects.toMatchObject({
      name: 'NotAllowedError',
    })
    expect(getUserMedia).toHaveBeenCalledTimes(1)

    getUserMedia.mockReset()
    getUserMedia
      .mockRejectedValueOnce(new DOMException('back', 'OverconstrainedError'))
      .mockResolvedValueOnce({ getTracks: () => [{ stop: () => {} }] })
    const video = videoEl()
    const stopScan = await startBarcodeDetector(video, () => {})
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(getUserMedia.mock.calls[1][0]).toEqual({ video: true, audio: false })
    expect(video.srcObject).toBeTruthy()
    stopScan()
    expect(video.srcObject).toBeNull()
  })
})

describe('startHtml5Scanner', () => {
  it('does not load the scanner into a box with no size', async () => {
    box('field-qr-reader', 0, 0)
    await expect(startHtml5Scanner('field-qr-reader', () => {})).rejects.toThrow(/no size/)
    expect(html5.start).not.toHaveBeenCalled()
  })

  it('tries the front camera when the back camera is refused, and labels the preview', async () => {
    box('field-qr-reader', 320, 320)
    let attempt = 0
    html5.start.mockImplementation(async () => {
      attempt += 1
      if (attempt === 1) throw new DOMException('back', 'OverconstrainedError')
      const video = document.createElement('video')
      Object.defineProperty(video, 'clientWidth', { configurable: true, value: 320 })
      Object.defineProperty(video, 'clientHeight', { configurable: true, value: 240 })
      document.getElementById('field-qr-reader').appendChild(video)
    })
    const stop = await startHtml5Scanner('field-qr-reader', () => {})
    expect(html5.start.mock.calls[0][0]).toEqual({ facingMode: 'environment' })
    expect(html5.start.mock.calls[1][0]).toEqual({ facingMode: 'user' })
    expect(document.querySelector('#field-qr-reader video').getAttribute('aria-label')).toBe(
      'Camera preview'
    )
    expect(document.querySelector('#field-qr-reader video').getAttribute('playsinline')).toBe(
      'true'
    )
    await stop()
    expect(html5.stop).toHaveBeenCalled()
  })
})
