// ─────────────────────────────────────────────────────────────────────────────
// A tiny data-URL stand-in for the organization logo.
//
// Uploads after M-5 store `logoPath` and used to leave `logoUrl` empty. The
// header then depended on an authenticated Storage fetch (getBlob →
// getDownloadURL). When that fetch failed — or when getDownloadURL returned a
// URL the `<img>` would not paint — there was nothing else to show. This thumb
// is written next to the path so the header and the theme sampler have the
// bytes without a round trip.
//
// The full file still goes to Storage (`logoPath`) so a resolved blob can
// replace this with a sharper mark. Until that fetch paints, the thumb is the
// header and the theme sample. A few kilobytes on the org document, read with
// the snapshot. It is not a bearer credential.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_EDGE = 128
const JPEG_QUALITY = 0.72

/**
 * Resize an image File to a small JPEG data URL suitable for `logoUrl`.
 *
 * @param {Blob|File} file
 * @returns {Promise<string>} data:image/jpeg;base64,…
 */
export function fileToLogoThumb(file) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type || '').startsWith('image/')) {
      reject(new Error('Logo thumb needs an image file'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the logo'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Could not decode the logo'))
      img.onload = () => {
        let { width, height } = img
        if (!width || !height) {
          reject(new Error('Logo has no dimensions'))
          return
        }
        if (width >= height && width > MAX_EDGE) {
          height = Math.round((height * MAX_EDGE) / width)
          width = MAX_EDGE
        } else if (height > MAX_EDGE) {
          width = Math.round((width * MAX_EDGE) / height)
          height = MAX_EDGE
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Could not draw the logo thumb'))
          return
        }
        // Cream fill so a transparent PNG does not vanish into the frosted
        // header the way a white fill did on white glass.
        ctx.fillStyle = '#faf3ea'
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}
