import { nativePlatform } from './native'

function isScanCancel(err) {
  const text = `${err?.code || ''} ${err?.message || ''}`.toLowerCase()
  return text.includes('cancel')
}

/**
 * The Google Play scanner module is not on the device until the first install.
 * `scan()` on Android uses it, and calling scan before it has finished fails
 * the only button the person came here to press.
 */
async function ensurePlayScanner(BarcodeScanner, State, onStatus) {
  const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()
  if (available) return
  onStatus?.('Installing the scanner…')
  let handle
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error('The scanner is still downloading. Try again in a moment, or paste the code.')
        )
      }, 90000)
      BarcodeScanner.addListener('googleBarcodeScannerModuleInstallProgress', (event) => {
        if (event.state === State.COMPLETED) {
          clearTimeout(timer)
          resolve()
        } else if (event.state === State.FAILED || event.state === State.CANCELED) {
          clearTimeout(timer)
          reject(new Error('The scanner could not be installed. Paste the code instead.'))
        }
      })
        .then((added) => {
          handle = added
          return BarcodeScanner.installGoogleBarcodeScannerModule()
        })
        .catch((err) => {
          clearTimeout(timer)
          reject(err)
        })
    })
  } finally {
    await handle?.remove?.().catch(() => {})
  }
}

/**
 * Open the native scanner and return the raw text of one QR code.
 * An empty string means the person closed it, or it read nothing.
 */
export async function scanWithNativeCamera({ onStatus } = {}) {
  const { BarcodeScanner, BarcodeFormat, GoogleBarcodeScannerModuleInstallState } =
    await import('@capacitor-mlkit/barcode-scanning')
  const { supported } = await BarcodeScanner.isSupported()
  if (!supported) {
    throw new Error('This device has no camera the scanner can use. Paste the code instead.')
  }
  if (nativePlatform() === 'android') {
    await ensurePlayScanner(BarcodeScanner, GoogleBarcodeScannerModuleInstallState, onStatus)
  }
  onStatus?.('Point the camera at the code')
  try {
    const { barcodes } = await BarcodeScanner.scan({
      formats: [BarcodeFormat.QrCode],
      autoZoom: true,
    })
    const code = barcodes?.[0]
    return code?.rawValue || code?.displayValue || ''
  } catch (err) {
    if (isScanCancel(err)) return ''
    throw err
  }
}
