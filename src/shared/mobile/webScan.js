// Browser camera for the field QR page and the LOTO tag scanner.
//
// BarcodeDetector is the platform API (Chromium, and Safari from 18.4). Where
// it is missing, html5-qrcode reads the same camera stream. Both stay out of
// the initial bundle: html5-qrcode loads when someone starts the camera.
//
// The preview element has to be on screen, with a real width, before either
// path starts. html5-qrcode stamps `style.width` from `clientWidth` at that
// moment and never sets a height. A `display: none` box is 0px wide, Tailwind
// preflight's `video { height: auto }` then keeps the picture at 0, and the
// scan frame — which is measured from that same client box on the `playing`
// event — is never drawn. The camera can be open with nothing on screen.
// iOS also refuses to paint a video that was `display: none` when `play()`
// ran, and a later play() is outside the tap that granted the camera.

export function canUseBarcodeDetector() {
  return typeof globalThis.BarcodeDetector === 'function'
}

/** Why the camera cannot even be asked for. Empty string means try it. */
export function cameraUnavailableReason({ fallback } = {}) {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return 'The camera only works on a secure page (https). Open this site with https, or paste the code.'
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return (
      fallback ||
      'This browser cannot scan from the camera. Paste the code, or use the Android or iOS app.'
    )
  }
  return ''
}

export function cameraErrorName(err) {
  if (err && typeof err === 'object' && err.name) return err.name
  const text = String(err?.message || err || '')
  const named = text.match(
    /NotAllowedError|PermissionDeniedError|NotFoundError|DevicesNotFoundError|NotReadableError|TrackStartError|OverconstrainedError|SecurityError|AbortError/
  )
  return named ? named[0] : ''
}

/**
 * A sentence for the banner. Abort is empty: the person closed the scanner,
 * and that is not a failure to announce. `fallback` is the line for a failure
 * this function does not recognise (the LOTO screen says "type the tag").
 */
export function cameraErrorMessage(err, { fallback } = {}) {
  const name = cameraErrorName(err)
  const text = String(err?.message || err || '')
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Camera permission was denied. Allow it in the browser settings, or paste the code.'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera was found on this device. Paste the code instead.'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The camera is in use by another app. Close it and try again, or paste the code.'
  }
  if (name === 'SecurityError' || /secure context/i.test(text)) {
    return 'The camera only works on a secure page (https). Open this site with https, or paste the code.'
  }
  if (name === 'AbortError') return ''
  // Sentences thrown by this file ("the preview has no size") are already
  // written for the banner. A library string is not, and stays generic.
  if (err instanceof Error && err.name === 'Error' && err.message) return err.message
  return fallback || 'The camera could not start. Paste the code instead.'
}

function retryableCameraError(err) {
  const name = cameraErrorName(err)
  // `facingMode: 'environment'` is a required constraint. A phone with only a
  // front camera, and the headless fake camera, reject it. Permission denied
  // must not be asked for again.
  return (
    name === 'OverconstrainedError' || name === 'NotFoundError' || name === 'DevicesNotFoundError'
  )
}

function prepareVideo(video) {
  // Set before play(), and before the permission prompt returns. iOS only
  // paints a camera stream that was muted and inline at the moment play() ran.
  video.muted = true
  video.defaultMuted = true
  video.autoplay = true
  video.playsInline = true
  video.setAttribute('muted', '')
  video.setAttribute('autoplay', '')
  video.setAttribute('playsinline', 'true')
  video.setAttribute('webkit-playsinline', 'true')
}

async function openCameraStream() {
  const attempts = [
    { video: { facingMode: { ideal: 'environment' } }, audio: false },
    { video: true, audio: false },
  ]
  let last
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (err) {
      last = err
      if (!retryableCameraError(err)) throw err
    }
  }
  throw last
}

function throwIfClosed(signal, video) {
  if (signal?.aborted || (video && !video.isConnected)) {
    throw new DOMException('The scan was closed.', 'AbortError')
  }
}

/** @returns {Promise<() => void>} stop */
export async function startBarcodeDetector(video, onCode, { signal } = {}) {
  if (!video) throw new Error('The camera preview is not on screen.')
  prepareVideo(video)
  const stream = await openCameraStream()
  const stopTracks = () => {
    stream.getTracks().forEach((track) => track.stop())
    if (video.srcObject === stream) video.srcObject = null
  }
  try {
    throwIfClosed(signal, video)
  } catch (err) {
    stopTracks()
    throw err
  }
  video.srcObject = stream
  try {
    await video.play()
  } catch (err) {
    stopTracks()
    throw err
  }
  try {
    throwIfClosed(signal, video)
  } catch (err) {
    stopTracks()
    throw err
  }
  const detector = new BarcodeDetector({ formats: ['qr_code'] })
  let stopped = false
  let timer = 0
  const tick = async () => {
    if (stopped) return
    try {
      const codes = await detector.detect(video)
      const raw = codes?.[0]?.rawValue
      if (raw) onCode(raw)
    } catch {
      // A frame can fail while the camera is still starting. The next one is fine.
    }
    if (!stopped) timer = window.setTimeout(tick, 200)
  }
  timer = window.setTimeout(tick, 200)
  return () => {
    if (stopped) return
    stopped = true
    window.clearTimeout(timer)
    stopTracks()
  }
}

async function waitForBox(element, signal) {
  for (let i = 0; i < 8; i += 1) {
    if (signal?.aborted) throw new DOMException('The scan was closed.', 'AbortError')
    if (element.clientWidth >= 50 && element.clientHeight >= 50) return
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
}

function tagPreview(element) {
  const surface = element.querySelector('video')
  if (!surface) return null
  prepareVideo(surface)
  surface.setAttribute('aria-label', 'Camera preview')
  return surface
}

async function releaseHtml5(scanner) {
  try {
    await scanner.stop()
  } catch {
    // stop() rejects when start() never reached SCANNING.
  }
  try {
    scanner.clear()
  } catch {
    // clear() rejects while a scan is still marked running.
  }
}

/** @returns {Promise<() => Promise<void>>} stop */
export async function startHtml5Scanner(elementId, onCode, { signal } = {}) {
  const element = typeof document === 'undefined' ? null : document.getElementById(elementId)
  if (!element) throw new Error('The camera preview is not on screen.')
  await waitForBox(element, signal)
  if (element.clientWidth < 50 || element.clientHeight < 50) {
    throw new Error('The camera preview has no size yet. Try again, or paste the code.')
  }
  if (signal?.aborted) throw new DOMException('The scan was closed.', 'AbortError')
  const { Html5Qrcode } = await import('html5-qrcode')
  // No qrbox. The library sizes that shade from the video's client box on
  // `playing`, which is the measurement Tailwind's `height: auto` collapses.
  // The frame the person sees is drawn by the page, on a box that already
  // has a size. The decoder reads the whole frame, so a code in view counts.
  const scanConfig = { fps: 8 }
  const startWith = async (camera) => {
    // `in window` is true for a BarcodeDetector that is not a constructor
    // (a stub, or a half-shipped build). The library then does `new` and the
    // start fails before any picture. Only hand it a detector we can call.
    const scanner = new Html5Qrcode(elementId, {
      verbose: false,
      useBarCodeDetectorIfSupported: typeof globalThis.BarcodeDetector === 'function',
    })
    try {
      await scanner.start(
        camera,
        scanConfig,
        (text) => onCode(text),
        () => {}
      )
      return scanner
    } catch (err) {
      await releaseHtml5(scanner)
      throw err
    }
  }
  let scanner
  try {
    scanner = await startWith({ facingMode: 'environment' })
  } catch (err) {
    if (!retryableCameraError(err)) throw err
    try {
      scanner = await startWith({ facingMode: 'user' })
    } catch (err2) {
      if (!retryableCameraError(err2)) throw err2
      const cameras = await Html5Qrcode.getCameras().catch(() => [])
      if (!cameras?.length) throw err2
      scanner = await startWith(cameras[0].id)
    }
  }
  if (signal?.aborted) {
    await releaseHtml5(scanner)
    throw new DOMException('The scan was closed.', 'AbortError')
  }
  const surface = tagPreview(element)
  if (!surface || surface.clientWidth < 2 || surface.clientHeight < 2) {
    await releaseHtml5(scanner)
    throw new Error('The camera preview did not appear. Try again, or paste the code.')
  }
  return () => releaseHtml5(scanner)
}

/** BarcodeDetector where the browser has it, html5-qrcode otherwise. */
export async function openScanner({ video, elementId, onCode, signal } = {}) {
  if (signal?.aborted) throw new DOMException('The scan was closed.', 'AbortError')
  if (canUseBarcodeDetector()) return startBarcodeDetector(video, onCode, { signal })
  return startHtml5Scanner(elementId, onCode, { signal })
}
