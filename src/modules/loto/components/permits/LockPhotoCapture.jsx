import { useRef, useState } from 'react'
import { lockPhotoStamp } from '../../utils/lockPhoto'

/**
 * Live camera only. There is no file input: a gallery picture is not a picture
 * of the lock that is on the machine right now.
 */
export default function LockPhotoCapture({ userName, permitNo, equipment, onPhoto }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')

  async function openCamera() {
    setError('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser has no camera. A lock photo has to be taken live.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
    } catch {
      setError('The camera could not be opened.')
    }
  }

  function takePhoto() {
    const video = videoRef.current
    if (!video?.videoWidth) {
      setError('The camera is not ready yet.')
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0)
    const stamp = lockPhotoStamp({ userName, permitNo, equipment })
    ctx.fillStyle = 'rgba(0,0,0,0.65)'
    ctx.fillRect(0, canvas.height - 36, canvas.width, 36)
    ctx.fillStyle = '#fff'
    ctx.font = '16px sans-serif'
    ctx.fillText(stamp, 8, canvas.height - 14)
    const url = canvas.toDataURL('image/jpeg', 0.8)
    setPreview(url)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    onPhoto({ dataUrl: url, stamp, at: Date.now() })
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-steel-300">
        Take a live photo of the lock with the tag on it. Gallery upload is not accepted.
      </p>
      <video ref={videoRef} className="max-h-48 w-full rounded-lg bg-black" playsInline muted aria-label="Live camera preview" />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-soft" onClick={openCamera}>Open camera</button>
        <button type="button" className="btn-primary" onClick={takePhoto}>Take photo</button>
      </div>
      {preview && <img src={preview} alt="Lock and tag just taken" className="max-h-48 rounded-lg" />}
      {error && <p role="alert" className="text-xs font-medium text-red-400">{error}</p>}
    </div>
  )
}
