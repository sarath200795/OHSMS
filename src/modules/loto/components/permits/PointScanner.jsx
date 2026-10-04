import { useEffect, useRef, useState } from 'react'
import Button from '../ui/Button'
import Input from '../ui/Input'

/**
 * Reads the QR on an isolation point's tag.
 *
 * Two ways in, because a tag on a wet valve in a dark plant room is not
 * reliably scannable:
 *   · the camera, through the browser's native BarcodeDetector (Chromium and
 *     Android; nothing is added to the bundle for it), and
 *   · a typed or pasted code — the link on the tag, or the short point number
 *     (E-1) printed beside the QR.
 *
 * `onCode(raw, method)` gets the raw text and 'camera' | 'manual'. Deciding
 * whether that code is one of THIS permit's points is the caller's job
 * (utils/tagScan.js), so a tag from the wrong machine is refused in one place.
 */
export default function PointScanner({ onCode, disabled = false }) {
  const cameraOk =
    typeof window !== 'undefined' &&
    'BarcodeDetector' in window &&
    Boolean(typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia)
  const [on, setOn] = useState(false)
  const [error, setError] = useState('')
  const [manual, setManual] = useState('')
  const video = useRef(null)
  // The latest callback without restarting the camera every time the parent re-renders.
  const handler = useRef(onCode)
  useEffect(() => {
    handler.current = onCode
  })

  useEffect(() => {
    if (!on) return undefined
    let stream = null
    let timer = null
    let live = true
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (!live || !video.current) return
        video.current.srcObject = stream
        await video.current.play()
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
        timer = setInterval(async () => {
          try {
            const found = await detector.detect(video.current)
            if (found[0]?.rawValue) handler.current(found[0].rawValue, 'camera')
          } catch {
            // A frame that cannot be read is just the next frame's problem.
          }
        }, 400)
      } catch {
        setError('The camera could not be opened. Type the code from the tag instead.')
        setOn(false)
      }
    })()
    return () => {
      live = false
      if (timer) clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [on])

  function submitManual(e) {
    e.preventDefault()
    if (!manual.trim()) return
    handler.current(manual, 'manual')
    setManual('')
  }

  return (
    <div className="space-y-3">
      {cameraOk ? (
        <div>
          <Button type="button" variant="steel" disabled={disabled} onClick={() => setOn((v) => !v)}>
            {on ? 'Stop camera' : 'Scan a tag with the camera'}
          </Button>
          {on && (
            <video
              ref={video}
              muted
              playsInline
              aria-label="Camera view for scanning the tag"
              className="mt-3 aspect-video w-full max-w-sm rounded-xl bg-black object-cover"
            />
          )}
        </div>
      ) : (
        <p className="text-xs text-steel-400">
          This browser cannot scan from the camera. Type the code from the tag below.
        </p>
      )}
      {error && <p role="alert" className="text-xs font-medium text-red-400">{error}</p>}
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
