import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, QrCode } from 'lucide-react'
import { parseQrPayload, routeForScan } from '../../shared/mobile/qrPayload'
import { isNativePlatform } from '../../shared/mobile/native'
import { canUseBarcodeDetector, startBarcodeDetector, startHtml5Scanner } from './webScan'

const UNKNOWN =
  'This QR code is not a WEEHS OHSMS label. Nothing was opened. Equipment labels start with /qr/, permits with /permit/.'

export default function Scan() {
  const navigate = useNavigate()
  const videoRef = useRef(null)
  const stopRef = useRef(() => {})
  const handled = useRef(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [live, setLive] = useState(false)
  const [pasted, setPasted] = useState('')

  const stop = useCallback(() => {
    const done = stopRef.current
    stopRef.current = () => {}
    try {
      const result = done?.()
      if (result && typeof result.then === 'function') result.catch(() => {})
    } catch {
      // The camera is already gone. The page still has to be usable.
    }
    setLive(false)
  }, [])

  useEffect(() => stop, [stop])

  const accept = useCallback(
    (raw) => {
      if (handled.current) return
      const to = routeForScan(parseQrPayload(raw))
      if (!to) {
        setError(UNKNOWN)
        setStatus('')
        return
      }
      handled.current = true
      stop()
      navigate(to)
    },
    [navigate, stop]
  )

  const start = async () => {
    setError('')
    setStatus('')
    handled.current = false
    stop()
    if (isNativePlatform()) {
      try {
        const { scanWithNativeCamera } = await import('../../shared/mobile/nativeScan')
        const raw = await scanWithNativeCamera({ onStatus: setStatus })
        setStatus('')
        if (!raw) return
        accept(raw)
      } catch (err) {
        setStatus('')
        setError(err?.message || 'The camera scanner could not start. Paste the code instead.')
      }
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser has no camera access. Paste the code, or use the Android or iOS app.')
      return
    }
    try {
      if (canUseBarcodeDetector() && videoRef.current) {
        stopRef.current = await startBarcodeDetector(videoRef.current, accept)
      } else {
        stopRef.current = await startHtml5Scanner('field-qr-reader', accept)
      }
      setLive(true)
      setStatus('Point the camera at the code')
    } catch (err) {
      setError(
        err?.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow it in the browser settings, or paste the code.'
          : 'The camera could not start. Paste the code instead.'
      )
    }
  }

  const submitPasted = (event) => {
    event.preventDefault()
    setError('')
    accept(pasted)
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-ink-900">Scan QR</h1>
      <p className="mt-1 text-sm text-ink-500">
        Point the camera at an extinguisher, AED or fire-alarm label. A code from somewhere else is
        left alone.
      </p>

      <div className="mt-4 overflow-hidden rounded-3xl bg-ink-900 ring-1 ring-ink-200">
        <video
          ref={videoRef}
          aria-label="Camera preview"
          className={`aspect-square w-full object-cover ${live && canUseBarcodeDetector() ? 'block' : 'hidden'}`}
          muted
          playsInline
        />
        <div
          id="field-qr-reader"
          className={live && !canUseBarcodeDetector() ? 'block' : 'hidden'}
        />
        {!live && (
          <div className="grid aspect-square place-items-center text-white/80">
            <QrCode size={48} aria-hidden="true" />
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <button type="button" className="btn-primary min-h-12 w-full" onClick={start}>
          <Camera size={18} aria-hidden="true" /> {live ? 'Scan again' : 'Start camera'}
        </button>
        {live && (
          <button type="button" className="btn-ghost min-h-12 w-full" onClick={stop}>
            Stop camera
          </button>
        )}
      </div>

      {status && (
        <p role="status" className="mt-3 text-sm font-medium text-ink-700">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-2xl bg-amber-50 px-3 py-3 text-sm text-amber-950">
          {error}
        </p>
      )}

      <form onSubmit={submitPasted} className="mt-6">
        <label htmlFor="pasted-code" className="label">
          Or paste the code
        </label>
        <input
          id="pasted-code"
          className="input"
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
          placeholder="https://…/qr/…"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck="false"
        />
        <button type="submit" className="btn-ghost mt-2 min-h-12 w-full">
          Open code
        </button>
      </form>
    </div>
  )
}
