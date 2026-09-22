// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileToLogoThumb } from './logoThumb'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fileToLogoThumb', () => {
  it('refuses a non-image', async () => {
    const file = new File(['%PDF'], 'x.pdf', { type: 'application/pdf' })
    await expect(fileToLogoThumb(file)).rejects.toThrow(/image/i)
  })

  it('returns a JPEG data URL for a tiny PNG', async () => {
    // 1×1 PNG
    const png = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      ),
      (c) => c.charCodeAt(0)
    )
    const file = new File([png], 'mark.png', { type: 'image/png' })

    // jsdom's Image does not decode; stub a 64×40 bitmap so the canvas path runs.
    const OriginalImage = globalThis.Image
    class FakeImage {
      constructor() {
        this.width = 64
        this.height = 40
        this.onload = null
        this.onerror = null
      }
      set src(_v) {
        queueMicrotask(() => this.onload && this.onload())
      }
    }
    globalThis.Image = FakeImage

    const drawImage = vi.fn()
    const fillRect = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect,
      drawImage,
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/jpeg;base64,thumb'
    )

    try {
      const out = await fileToLogoThumb(file)
      expect(out).toBe('data:image/jpeg;base64,thumb')
      expect(drawImage).toHaveBeenCalled()
      expect(fillRect).toHaveBeenCalled()
    } finally {
      globalThis.Image = OriginalImage
    }
  })
})
