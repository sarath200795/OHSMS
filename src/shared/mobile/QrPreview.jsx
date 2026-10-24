import { canUseBarcodeDetector } from './webScan'
import ScanFrame from './ScanFrame'

/**
 * The box the camera paints into.
 *
 * `active` has to be true for a commit BEFORE the scanner starts. The effect
 * that calls `openScanner` runs after this paint, so the video (BarcodeDetector)
 * or `#reader` (html5-qrcode) already has a layout box. Starting from a click
 * handler while this box is still `hidden` is what left the phone with an
 * open camera and a blank screen.
 */
export default function QrPreview({
  active,
  videoRef,
  readerId,
  status = '',
  label = 'Camera preview',
  className = '',
  aspectClass = 'aspect-square',
  idle = null,
}) {
  const detector = canUseBarcodeDetector()
  return (
    <div
      data-scan-stage=""
      className={`relative w-full overflow-hidden bg-ink-900 ring-1 ring-ink-200 ${aspectClass} ${className}`}
    >
      <video
        ref={(node) => {
          if (videoRef) videoRef.current = node
          if (!node) return
          node.muted = true
          node.setAttribute('playsinline', 'true')
          node.setAttribute('webkit-playsinline', 'true')
        }}
        muted
        playsInline
        aria-label={label}
        className={
          active && detector ? 'absolute inset-0 h-full w-full bg-black object-contain' : 'hidden'
        }
      />
      <div
        id={readerId}
        className={active && !detector ? 'qr-scan-portal' : 'qr-scan-portal hidden'}
      />
      {active ? <ScanFrame status={status} /> : idle}
    </div>
  )
}
