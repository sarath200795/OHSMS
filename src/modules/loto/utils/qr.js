import QRCode from 'qrcode'

/** Generate a PNG data URL for a QR code encoding `text`. */
export async function qrDataUrl(text, opts = {}) {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 1,
    scale: opts.scale || 6,
    color: { dark: '#11161f', light: '#ffffff' },
    ...opts,
  })
}
