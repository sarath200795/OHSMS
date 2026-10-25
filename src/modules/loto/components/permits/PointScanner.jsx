import { useEffect, useRef, useState } from 'react'
import QrPreview from '../../../../shared/mobile/QrPreview'
import {
  cameraErrorMessage,
  cameraUnavailableReason,
  openScanner,
} from '../../../../shared/mobile/webScan'
import Button from '../ui/Button'
import Input from '../ui/Input'

const STARTING = 'Starting the camera…'
const SCANNING = 'Scanning. Point the camera at the tag.'

/**
 * Reads the QR on an isolation point's tag.
 *
 * Two ways in, because a tag on a wet valve in a dark plant room is not
 * reliably scannable:
 *   · the camera — BarcodeDetector where the browser has it, otherwise
 *     html5-qrcode, same as the field QR page, and
 *   · a typed or pasted code — the link on the tag, or the short point number
 *     (E-1) printed beside the QR.
 *
 * `onCode(raw, method)` gets the raw text and 'camera' | 'manual'. Deciding
 * whether that code is one of THIS permit's points is the caller's job
 * (utils/tagScan.js), so a tag from the wrong machine is refused in one place.
 */
export default function PointScanner({ onCode, disabled = false }) {
  const unavailable = cameraUnavailableReason({
    fallback: 'This browser cannot scan from the camera. Type the code from the tag below.',
  })
  const [on, setOn] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [manual, setManual] = useState('')
  const video = useRef(null)
  // The latest callback without restarting the camera every time the parent re-renders.
  const handler = useRef(onCode)
  useEffect(() => {
    handler.current = onCode
  })

  useEffect(() => {
    if (!on) return undefined
    const ac = new AbortController()
    let halt = () => {}
    setStatus(STARTING)
    ;(async () => {
      try {
        const stopScan = await openScanner({
          video: video.current,
          elementId: 'loto-point-reader',
          onCode: (raw) => handler.current(raw, 'camera'),
          signal: ac.signal,
        })
        if (ac.signal.aborted) {
          await stopScan()
          return
        }
        halt = stopScan
        setError('')
        setStatus(SCANNING)
      } catch (err) {
        if (ac.signal.aborted || err?.name === 'AbortError') return
        setError(
          cameraErrorMessage(err, {
            fallback: 'The camera could not be opened. Type the code from the tag instead.',
          })
        )
        setStatus('')
        setOn(false)
      }
    })()
    return () => {
      ac.abort()
      try {
        const result = halt()
        if (result && typeof result.then === 'function') result.catch(() => {})
      } catch {
        // The camera is already gone.
      }
    }
  }, [on])

  function toggle() {
    setError('')
    if (on) {
      setStatus('')
      setOn(false)
      return
    }
    setStatus(STARTING)
    setOn(true)
  }

  function submitManual(e) {
    e.preventDefault()
    if (!manual.trim()) return
    handler.current(manual, 'manual')
    setManual('')
  }

  return (
    <div className="space-y-3">
      {unavailable ? (
        <p className="text-xs text-steel-400">{unavailable}</p>
      ) : (
        <div>
          <Button type="button" variant="steel" disabled={disabled} onClick={toggle}>
            {on ? 'Stop camera' : 'Scan a tag with the camera'}
          </Button>
          {on && (
            <QrPreview
              active
              videoRef={video}
              readerId="loto-point-reader"
              status={status}
              label="Camera view for scanning the tag"
              aspectClass="aspect-video"
              className="mt-3 max-w-sm rounded-xl"
            />
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs font-medium text-red-400">
          {error}
        </p>
      )}
      <form onSubmit={submitManual} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1">
          <Input
            label="Tag code (link or point number, e.g. E-1)"
            value={manual}
            disabled={disabled}
            onChange={(e) => setManual(e.target.value)}
          />
        </div>
        <Button type="submit" variant="steel" disabled={disabled || !manual.trim()}>
          Record scan
        </Button>
      </form>
    </div>
  )
}
