// Browser camera for the installed PWA and for a phone tab.
//
// BarcodeDetector is the platform API (Chromium, and Safari from 18.4). Where
// it is missing, html5-qrcode reads the same camera stream. Both stay out of
// the initial bundle: they load when someone starts the camera.

export function canUseBarcodeDetector() {
  return typeof globalThis.BarcodeDetector === 'function'
}

/** @returns {Promise<() => void>} stop */
export async function startBarcodeDetector(video, onCode) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' } },
    audio: false,
  })
  video.srcObject = stream
  video.setAttribute('playsinline', 'true')
  await video.play()
  const detector = new BarcodeDetector({ formats: ['qr_code'] })
  let stopped = false
  let timer = 0
  const tick = async () => {
    if (stopped) return
    try {
      const codes = await detector.detect(video)
      const raw = codes?.[0]?.rawValue
      if (raw) {
        onCode(raw)
        return
      }
    } catch {
      // A frame can fail while the camera is still starting. The next one is fine.
    }
    timer = window.setTimeout(tick, 200)
  }
  timer = window.setTimeout(tick, 200)
  return () => {
    stopped = true
    window.clearTimeout(timer)
    stream.getTracks().forEach((track) => track.stop())
    video.srcObject = null
  }
}

/** @returns {Promise<() => void>} stop */
export async function startHtml5Scanner(elementId, onCode) {
  const { Html5Qrcode } = await import('html5-qrcode')
  const scanner = new Html5Qrcode(elementId, { verbose: false })
  await scanner.start(
    { facingMode: 'environment' },
    { fps: 8, qrbox: { width: 240, height: 240 } },
    (text) => onCode(text),
    () => {}
  )
  return async () => {
    try {
      await scanner.stop()
    } catch {
      // stop() rejects when the camera was already released.
    }
    try {
      scanner.clear()
    } catch {
      // clear() rejects when start() never attached a view.
    }
  }
}
